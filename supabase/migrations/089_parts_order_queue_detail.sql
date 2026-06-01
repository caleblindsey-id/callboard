-- Project the free-text `detail` field (catch-all items like SHOP SUPPLIES,
-- migration 088) from the parts_requested JSONB onto the parts_order_queue
-- view so /parts-queue and /my-parts can show "DESCRIPTION — detail".
--
-- CREATE OR REPLACE VIEW can only APPEND columns, so `detail` is added as the
-- last column of both UNION branches. security_invoker=on is preserved (RLS:
-- staff see all rows, techs see only their own tickets).

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
    elem.value ->> 'detail'::text AS detail
   FROM pm_tickets pm
     JOIN customers c ON c.id = pm.customer_id
     LEFT JOIN users u ON u.id = pm.assigned_technician_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pm.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
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
    elem.value ->> 'detail'::text AS detail
   FROM service_tickets st
     JOIN customers c ON c.id = st.customer_id
     LEFT JOIN users u ON u.id = st.assigned_technician_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.parts_requested, '[]'::jsonb)) WITH ORDINALITY elem(value, ord)
  WHERE jsonb_typeof(COALESCE(st.parts_requested, '[]'::jsonb)) = 'array'::text
    AND NOT ((st.status = ANY (ARRAY['open'::text, 'estimated'::text])) AND COALESCE(elem.value ->> 'status'::text, 'requested'::text) = 'requested'::text);
