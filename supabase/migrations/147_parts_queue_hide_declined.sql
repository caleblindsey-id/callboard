-- Parts Queue: stop surfacing uncommitted parts once the repair is dead.
--
-- Feedback #81 (Elijah, coordinator, 2026-07-22): three estimates were declined
-- by customers that morning (WO 648 13:45, WO 668 14:22, WO 667 14:36) and their
-- parts appeared in the Parts Queue as live work. He cancelled all twelve by
-- hand that afternoon, reason "PARTS CAME BACK TO CUE AFTER DECLINE OF REPAIR".
--
-- The parts did not come *back*. They arrived for the first time, and the
-- decline is what let them in. The service branch's estimate gate (migration
-- 055, extended to pending_review by 102) reads:
--
--   NOT (st.status IN ('open','estimated') AND part.status IN ('requested','pending_review'))
--
-- i.e. hide a part the customer has not approved yet. But it keys on 'open' and
-- 'estimated' ONLY. `estimated -> declined` moves the ticket out of that list,
-- the predicate stops matching, and every pending_review part on the ticket
-- pops into the queue as actionable procurement for a repair that will never
-- happen. 'canceled' has the same hole (open -> canceled).
--
-- Two changes here:
--
-- 1) Add 'declined' and 'canceled' to that status list. Kept as an extension of
--    the existing PER-ROW rule rather than a blanket ticket filter, for the same
--    reason migration 055 wrote it per-row: a part already 'ordered' or
--    'received' is a real PO the office still has to return or restock, and it
--    must stay visible even though the repair died. Only the uncommitted
--    ('requested' / 'pending_review') parts drop off.
--
-- 2) Guard both branches on deleted_at IS NULL. Soft-deleted tickets keep their
--    pre-delete status and RLS does not filter them (AGENTS.md), so the queue
--    was also showing parts off deleted tickets — 19 rows in prod at the time of
--    writing, 12 of them not cancelled. Same class of phantom work item.
--
-- No backfill: the twelve rows from #81 were already cancelled by hand, and no
-- other declined/canceled ticket carries an uncommitted part. This is forward-
-- looking only.
--
-- Column list is reproduced verbatim from the live definition (migration 105
-- plus po_due_date from 116) so CREATE OR REPLACE accepts it — only the WHERE
-- clauses differ. security_invoker=on preserved.

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
    pol.due_date AS po_due_date
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
    pol.due_date AS po_due_date
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
