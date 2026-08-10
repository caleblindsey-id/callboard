-- 158: expose the PARENT TICKET's status on every Parts Queue row.
--
-- The queue has never carried it. That is fine for most tabs, but it strands
-- the To Pull tab: a part triaged 'Pull from Stock' whose ticket is completed
-- or billed before anyone tapped Mark Pulled sits in To Pull forever, looking
-- identical to a part someone still needs to walk to the shelf and grab.
--
-- Neither ticket type gates completion on pulled_at (service gates only on
-- 'pending_review' via partsAwaitingReview; PM's partsOnOrder accepts
-- 'from_stock' regardless of pulled_at), and that is deliberate — technicians
-- cannot reach /parts-queue or run mark_pulled, so blocking them on a warehouse
-- record they are not allowed to write would be nagging the wrong person. The
-- fix is to LABEL the stranded rows, not to prevent them. This column is what
-- lets the UI tell the two apart.
--
-- Measured on prod before writing this: 7 rows in To Pull, 5 of them on
-- already-closed tickets (4 billed, 1 completed). Scope is genuinely limited to
-- from_stock — 'ordered', 'requested' and 'pending_review' parts appear on zero
-- closed tickets, and the Received tab is already 14-day-scoped.
--
-- Appended after 150's shipping_charge because CREATE OR REPLACE VIEW only
-- accepts new columns at the END of the list, and both UNION branches must gain
-- it at the same position or the union will not line up. Everything above
-- ticket_status is verbatim from 150.
--
-- Deliberately does NOT add a parent-status filter. getPartsQueue() has never
-- had one, and src/lib/db/parts-queue.ts documents why getMyPartsQueue and
-- getPartsMissingFromWorkOrder bypass the view instead. This change is purely
-- additive: existing readers keep seeing exactly the rows they saw before.

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
    pm.shipping_charge,
    pm.status AS ticket_status
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
    st.shipping_charge,
    st.status AS ticket_status
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
