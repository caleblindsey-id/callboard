-- 150: surface the parent ticket's freight charge on the Parts Queue rows.
--
-- Follows 149, which added the per-part shipping_method/shipping_note. This one
-- is the other half: the ticket-level shipping_charge (migration 148) has to be
-- READABLE from the queue, not just writable, for two reasons —
--
--   1) The mark-ordered freight prompt only fires when the ticket has no
--      freight recorded yet. Without the column here the client cannot tell,
--      and would either re-prompt on every part of the same PO (noise, which is
--      how prompts get dismissed reflexively) or never prompt at all.
--   2) The buyer needs to SEE the number already on the ticket to correct it
--      when the vendor invoice lands with a different figure.
--
-- Appended after 149's two columns because CREATE OR REPLACE VIEW only accepts
-- new columns at the end of the list. Everything above is verbatim from 149.
-- Kept as its own migration rather than folded into 149 for the same reason
-- this view already has eight amending migrations (036, 041, 070, 089, 090,
-- 096, 102, 147): each one is a legible step, and rewriting an applied file
-- would leave the repo and the database disagreeing about what 149 was.

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
    elem.value ->> 'shipping_note'::text AS shipping_note,
    pm.shipping_charge
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
    elem.value ->> 'shipping_note'::text AS shipping_note,
    st.shipping_charge
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
