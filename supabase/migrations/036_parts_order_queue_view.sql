-- 036_parts_order_queue_view.sql
-- Cross-table view that exposes one row per part request across both
-- pm_tickets and service_tickets. Drives the /parts-queue office page.
--
-- Extends the PartRequest JSONB shape (no column migration needed):
--   vendor (text, optional)
--   cancelled (boolean, optional)
--   cancel_reason (text, optional)
--   requested_at (timestamptz, optional; falls back to ticket.updated_at)
--   ordered_at  (timestamptz, optional)
--   received_at (timestamptz, optional)
--   ordered_by  (uuid, optional — auth.uid when office marked ordered)
--   received_by (uuid, optional — auth.uid when office marked received)
--
-- security_invoker=on makes the view respect the calling user's RLS on the
-- underlying tables. Staff (super_admin/manager/coordinator) see everything;
-- technicians see only their own assigned tickets (existing pm_tickets /
-- service_tickets policies apply).

CREATE OR REPLACE VIEW parts_order_queue
WITH (security_invoker = on) AS
SELECT
  'pm'::text                                                           AS source,
  pm.id                                                                AS ticket_id,
  pm.work_order_number                                                 AS work_order_number,
  (elem.ord - 1)::int                                                  AS part_index,
  pm.customer_id                                                       AS customer_id,
  c.name                                                               AS customer_name,
  pm.assigned_technician_id                                            AS assigned_technician_id,
  u.name                                                               AS assigned_technician_name,
  pm.synergy_order_number                                              AS synergy_order_number,
  COALESCE((elem.value->>'requested_at')::timestamptz, pm.updated_at)  AS requested_at,
  elem.value->>'description'                                           AS description,
  NULLIF(elem.value->>'quantity', '')::numeric                         AS quantity,
  elem.value->>'vendor'                                                AS vendor,
  elem.value->>'product_number'                                        AS product_number,
  NULLIF(elem.value->>'synergy_product_id', '')::int                   AS synergy_product_id,
  elem.value->>'po_number'                                             AS po_number,
  COALESCE(elem.value->>'status', 'requested')                         AS status,
  COALESCE((elem.value->>'cancelled')::boolean, false)                 AS cancelled,
  elem.value->>'cancel_reason'                                         AS cancel_reason,
  (elem.value->>'ordered_at')::timestamptz                             AS ordered_at,
  (elem.value->>'received_at')::timestamptz                            AS received_at,
  NULLIF(elem.value->>'ordered_by', '')::uuid                          AS ordered_by,
  NULLIF(elem.value->>'received_by', '')::uuid                         AS received_by
FROM pm_tickets pm
JOIN customers c ON c.id = pm.customer_id
LEFT JOIN users u ON u.id = pm.assigned_technician_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pm.parts_requested, '[]'::jsonb))
  WITH ORDINALITY AS elem(value, ord)
WHERE jsonb_typeof(COALESCE(pm.parts_requested, '[]'::jsonb)) = 'array'

UNION ALL

SELECT
  'service'::text                                                      AS source,
  st.id                                                                AS ticket_id,
  st.work_order_number                                                 AS work_order_number,
  (elem.ord - 1)::int                                                  AS part_index,
  st.customer_id                                                       AS customer_id,
  c.name                                                               AS customer_name,
  st.assigned_technician_id                                            AS assigned_technician_id,
  u.name                                                               AS assigned_technician_name,
  st.synergy_order_number                                              AS synergy_order_number,
  COALESCE((elem.value->>'requested_at')::timestamptz, st.updated_at)  AS requested_at,
  elem.value->>'description'                                           AS description,
  NULLIF(elem.value->>'quantity', '')::numeric                         AS quantity,
  elem.value->>'vendor'                                                AS vendor,
  elem.value->>'product_number'                                        AS product_number,
  NULLIF(elem.value->>'synergy_product_id', '')::int                   AS synergy_product_id,
  elem.value->>'po_number'                                             AS po_number,
  COALESCE(elem.value->>'status', 'requested')                         AS status,
  COALESCE((elem.value->>'cancelled')::boolean, false)                 AS cancelled,
  elem.value->>'cancel_reason'                                         AS cancel_reason,
  (elem.value->>'ordered_at')::timestamptz                             AS ordered_at,
  (elem.value->>'received_at')::timestamptz                            AS received_at,
  NULLIF(elem.value->>'ordered_by', '')::uuid                          AS ordered_by,
  NULLIF(elem.value->>'received_by', '')::uuid                         AS received_by
FROM service_tickets st
JOIN customers c ON c.id = st.customer_id
LEFT JOIN users u ON u.id = st.assigned_technician_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.parts_requested, '[]'::jsonb))
  WITH ORDINALITY AS elem(value, ord)
WHERE jsonb_typeof(COALESCE(st.parts_requested, '[]'::jsonb)) = 'array';

GRANT SELECT ON parts_order_queue TO authenticated;

COMMENT ON VIEW parts_order_queue IS
  'One row per part request across pm_tickets and service_tickets. Drives the office Parts Queue page. RLS inherits from base tables via security_invoker=on.';
