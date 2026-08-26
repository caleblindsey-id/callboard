-- 149: let the Parts Queue write the freight charge and read the requested
-- shipping method. Feedback #80 — see 148_shipping_charge.sql for the why.
--
-- Two recreations, both additive:
--
-- 1) fn_update_parts_queue gains shipping_charge. The function has a hard-coded
--    column list, so without this the ticket-level write from the Parts Queue
--    would be accepted and silently do nothing. The buyer placing the PO is the
--    one person who sees the vendor's freight quote, so that is where the number
--    has to be capturable — and it has to ride the SAME optimistic lock as
--    everything else the queue writes.
--
--    NULLIF(... ,'')::numeric mirrors the synergy_order_number shape: a payload
--    that omits the key leaves the column alone, and an explicit JSON null
--    clears it back to "no freight charged".
--
-- 2) parts_order_queue projects shipping_method / shipping_note out of the
--    parts_requested JSONB element, the same way migration 070 added
--    vendor_code. Without these the queue cannot show the buyer that a customer
--    asked for next-day air, which is half of what #80 asked for.
--
--    Appended at the END of both UNION branches on purpose: CREATE OR REPLACE
--    VIEW will only accept new columns added after the existing ones, and both
--    branches must stay positionally aligned. Everything above the two new lines
--    is reproduced verbatim from migration 147.

CREATE OR REPLACE FUNCTION public.fn_update_parts_queue(
  p_source              text,
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz,
  p_update_payload      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_id   uuid := auth.uid();
  v_updated     jsonb;
BEGIN
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF v_caller_role NOT IN ('super_admin', 'manager', 'coordinator') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_source = 'pm' THEN
    UPDATE pm_tickets
       SET parts_requested       = COALESCE(p_update_payload -> 'parts_requested', parts_requested),
           parts_used            = COALESCE(p_update_payload -> 'parts_used', parts_used),
           additional_parts_used = COALESCE(p_update_payload -> 'additional_parts_used', additional_parts_used),
           synergy_order_number  = CASE
             WHEN p_update_payload ? 'synergy_order_number'
               THEN NULLIF(p_update_payload ->> 'synergy_order_number', '')
             ELSE synergy_order_number
           END,
           shipping_charge       = CASE
             WHEN p_update_payload ? 'shipping_charge'
               THEN NULLIF(p_update_payload ->> 'shipping_charge', '')::numeric
             ELSE shipping_charge
           END
     WHERE id            = p_ticket_id
       AND updated_at    = p_expected_updated_at
     RETURNING to_jsonb(pm_tickets.*) INTO v_updated;

  ELSIF p_source = 'service' THEN
    UPDATE service_tickets
       SET parts_requested      = COALESCE(p_update_payload -> 'parts_requested', parts_requested),
           parts_used           = COALESCE(p_update_payload -> 'parts_used', parts_used),
           parts_received       = CASE
             WHEN p_update_payload ? 'parts_received'
               THEN (p_update_payload ->> 'parts_received')::boolean
             ELSE parts_received
           END,
           synergy_order_number = CASE
             WHEN p_update_payload ? 'synergy_order_number'
               THEN NULLIF(p_update_payload ->> 'synergy_order_number', '')
             ELSE synergy_order_number
           END,
           shipping_charge      = CASE
             WHEN p_update_payload ? 'shipping_charge'
               THEN NULLIF(p_update_payload ->> 'shipping_charge', '')::numeric
             ELSE shipping_charge
           END
     WHERE id            = p_ticket_id
       AND updated_at    = p_expected_updated_at
     RETURNING to_jsonb(service_tickets.*) INTO v_updated;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE' USING ERRCODE = '22023';
  END IF;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK' USING ERRCODE = '40001';
  END IF;

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE VIEW public.parts_order_queue
WITH (security_invoker = on) AS
 SELECT 'pm'::text AS source,
    pm.id AS ticket_id,
    pm.work_order_number,
    (elem.ord - 1)::integer AS part_index,
    pm.customer_id,
    c.name AS customer_name,
    pm.assigned_technician_id,
    u.name AS assigned_technician_name,
    pm.synergy_order_number,
    pm.synergy_validation_status,
    pm.parts_validation_status,
    pm.synergy_validated_at,
    COALESCE((elem.value ->> 'requested_at'::text)::timestamp with time zone, pm.updated_at) AS requested_at,
    elem.value ->> 'description'::text AS description,
    NULLIF(elem.value ->> 'quantity'::text, ''::text)::numeric AS quantity,
    elem.value ->> 'vendor'::text AS vendor,
    elem.value ->> 'vendor_code'::text AS vendor_code,
    elem.value ->> 'product_number'::text AS product_number,
    NULLIF(elem.value ->> 'synergy_product_id'::text, ''::text)::integer AS synergy_product_id,
    elem.value ->> 'vendor_item_code'::text AS vendor_item_code,
    elem.value ->> 'po_number'::text AS po_number,
    COALESCE(elem.value ->> 'status'::text, 'requested'::text) AS status,
    COALESCE((elem.value ->> 'cancelled'::text)::boolean, false) AS cancelled,
    elem.value ->> 'cancel_reason'::text AS cancel_reason,
    (elem.value ->> 'ordered_at'::text)::timestamp with time zone AS ordered_at,
    (elem.value ->> 'received_at'::text)::timestamp with time zone AS received_at,
    NULLIF(elem.value ->> 'ordered_by'::text, ''::text)::uuid AS ordered_by,
    NULLIF(elem.value ->> 'received_by'::text, ''::text)::uuid AS received_by,
    elem.value ->> 'detail'::text AS detail,
    NULLIF(elem.value ->> 'unit_price'::text, ''::text)::numeric AS unit_price,
    e.make AS machine_make,
    e.model AS machine_model,
    e.serial_number AS machine_serial,
    (elem.value ->> 'covered_by_agreement'::text)::boolean AS covered_by_agreement,
    pr.qty_on_hand,
    pr.qty_on_po,
    NULLIF(elem.value ->> 'triaged_by'::text, ''::text)::uuid AS triaged_by,
    (elem.value ->> 'triaged_at'::text)::timestamp with time zone AS triaged_at,
    elem.value ->> 'triage_reason'::text AS triage_reason,
    NULLIF(elem.value ->> 'qoh_at_triage'::text, ''::text)::integer AS qoh_at_triage,
    NULLIF(elem.value ->> 'qopo_at_triage'::text, ''::text)::integer AS qopo_at_triage,
    (elem.value ->> 'pulled_at'::text)::timestamp with time zone AS pulled_at,
    NULLIF(elem.value ->> 'pulled_by'::text, ''::text)::uuid AS pulled_by,
    pr.bin_location,
    pol.due_date AS po_due_date,
    elem.value ->> 'shipping_method'::text AS shipping_method,
    elem.value ->> 'shipping_note'::text AS shipping_note
   FROM pm_tickets pm
     JOIN customers c ON c.id = pm.customer_id
     LEFT JOIN users u ON u.id = pm.assigned_technician_id
     LEFT JOIN equipment e ON e.id = pm.equipment_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pm.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
     LEFT JOIN products pr ON pr.number::text = (elem.value ->> 'product_number'::text)
     LEFT JOIN synergy_po_lines pol ON pol.po_number = (elem.value ->> 'po_number'::text) AND pol.product_number = (elem.value ->> 'product_number'::text)
  WHERE jsonb_typeof(COALESCE(pm.parts_requested, '[]'::jsonb)) = 'array'::text
    AND pm.deleted_at IS NULL
UNION ALL
 SELECT 'service'::text AS source,
    st.id AS ticket_id,
    st.work_order_number,
    (elem.ord - 1)::integer AS part_index,
    st.customer_id,
    c.name AS customer_name,
    st.assigned_technician_id,
    u.name AS assigned_technician_name,
    st.synergy_order_number,
    st.synergy_validation_status,
    st.parts_validation_status,
    st.synergy_validated_at,
    COALESCE((elem.value ->> 'requested_at'::text)::timestamp with time zone, st.updated_at) AS requested_at,
    elem.value ->> 'description'::text AS description,
    NULLIF(elem.value ->> 'quantity'::text, ''::text)::numeric AS quantity,
    elem.value ->> 'vendor'::text AS vendor,
    elem.value ->> 'vendor_code'::text AS vendor_code,
    elem.value ->> 'product_number'::text AS product_number,
    NULLIF(elem.value ->> 'synergy_product_id'::text, ''::text)::integer AS synergy_product_id,
    elem.value ->> 'vendor_item_code'::text AS vendor_item_code,
    elem.value ->> 'po_number'::text AS po_number,
    COALESCE(elem.value ->> 'status'::text, 'requested'::text) AS status,
    COALESCE((elem.value ->> 'cancelled'::text)::boolean, false) AS cancelled,
    elem.value ->> 'cancel_reason'::text AS cancel_reason,
    (elem.value ->> 'ordered_at'::text)::timestamp with time zone AS ordered_at,
    (elem.value ->> 'received_at'::text)::timestamp with time zone AS received_at,
    NULLIF(elem.value ->> 'ordered_by'::text, ''::text)::uuid AS ordered_by,
    NULLIF(elem.value ->> 'received_by'::text, ''::text)::uuid AS received_by,
    elem.value ->> 'detail'::text AS detail,
    NULLIF(elem.value ->> 'unit_price'::text, ''::text)::numeric AS unit_price,
    COALESCE(st.equipment_make, e.make) AS machine_make,
    COALESCE(st.equipment_model, e.model) AS machine_model,
    COALESCE(st.equipment_serial_number, e.serial_number) AS machine_serial,
    NULL::boolean AS covered_by_agreement,
    pr.qty_on_hand,
    pr.qty_on_po,
    NULLIF(elem.value ->> 'triaged_by'::text, ''::text)::uuid AS triaged_by,
    (elem.value ->> 'triaged_at'::text)::timestamp with time zone AS triaged_at,
    elem.value ->> 'triage_reason'::text AS triage_reason,
    NULLIF(elem.value ->> 'qoh_at_triage'::text, ''::text)::integer AS qoh_at_triage,
    NULLIF(elem.value ->> 'qopo_at_triage'::text, ''::text)::integer AS qopo_at_triage,
    (elem.value ->> 'pulled_at'::text)::timestamp with time zone AS pulled_at,
    NULLIF(elem.value ->> 'pulled_by'::text, ''::text)::uuid AS pulled_by,
    pr.bin_location,
    pol.due_date AS po_due_date,
    elem.value ->> 'shipping_method'::text AS shipping_method,
    elem.value ->> 'shipping_note'::text AS shipping_note
   FROM service_tickets st
     JOIN customers c ON c.id = st.customer_id
     LEFT JOIN users u ON u.id = st.assigned_technician_id
     LEFT JOIN equipment e ON e.id = st.equipment_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
     LEFT JOIN products pr ON pr.number::text = (elem.value ->> 'product_number'::text)
     LEFT JOIN synergy_po_lines pol ON pol.po_number = (elem.value ->> 'po_number'::text) AND pol.product_number = (elem.value ->> 'product_number'::text)
  WHERE jsonb_typeof(COALESCE(st.parts_requested, '[]'::jsonb)) = 'array'::text
    AND st.deleted_at IS NULL
    AND NOT ((st.status = ANY (ARRAY['open'::text, 'estimated'::text, 'declined'::text, 'canceled'::text])) AND COALESCE(elem.value ->> 'status'::text, 'requested'::text) = ANY (ARRAY['requested'::text, 'pending_review'::text]));

NOTIFY pgrst, 'reload schema';
