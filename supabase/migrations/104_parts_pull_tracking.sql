-- "To Be Pulled" stock-pull fulfillment workflow. Builds on migration 102's
-- Review step. Two changes:
--
-- 1) parts_ready_notified_at on both ticket tables — dedup anchor for the
--    "your parts are ready for pickup" tech notification (Round 2). The whole
--    order is "filled" when every live part is received OR pulled-from-stock;
--    we stamp this once on that transition and reset it if the order falls back
--    out of the filled state (a part added/reopened) so a later re-fill notifies
--    again. Added here so the view rebuild + columns ship in one migration.
--
-- 2) Project the physical-pull state onto each queue row:
--      pulled_at / pulled_by  <- the parts_requested JSONB element
--    A 'from_stock' part with no pulled_at is "To Pull" (still on the shelf);
--    with pulled_at set it's been physically pulled and staged for the tech.
--    CREATE OR REPLACE VIEW can only APPEND columns, so both are added LAST in
--    each UNION branch (after qopo_at_triage), matching migration 102's pattern.
--
-- security_invoker=on preserved (RLS: staff see all rows, techs see only their
-- own tickets).

ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS parts_ready_notified_at timestamptz;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS parts_ready_notified_at timestamptz;

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
    NULLIF(elem.value ->> 'pulled_by'::text, ''::text)::uuid AS pulled_by
   FROM pm_tickets pm
     JOIN customers c ON c.id = pm.customer_id
     LEFT JOIN users u ON u.id = pm.assigned_technician_id
     LEFT JOIN equipment e ON e.id = pm.equipment_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pm.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
     LEFT JOIN products pr ON pr.number = (elem.value ->> 'product_number'::text)
  WHERE jsonb_typeof(COALESCE(pm.parts_requested, '[]'::jsonb)) = 'array'::text
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
    NULLIF(elem.value ->> 'pulled_by'::text, ''::text)::uuid AS pulled_by
   FROM service_tickets st
     JOIN customers c ON c.id = st.customer_id
     LEFT JOIN users u ON u.id = st.assigned_technician_id
     LEFT JOIN equipment e ON e.id = st.equipment_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
     LEFT JOIN products pr ON pr.number = (elem.value ->> 'product_number'::text)
  WHERE jsonb_typeof(COALESCE(st.parts_requested, '[]'::jsonb)) = 'array'::text
    AND NOT ((st.status = ANY (ARRAY['open'::text, 'estimated'::text])) AND COALESCE(elem.value ->> 'status'::text, 'requested'::text) = ANY (ARRAY['requested'::text, 'pending_review'::text]));

-- Refresh the PostgREST schema cache so the new columns are served immediately.
NOTIFY pgrst, 'reload schema';
