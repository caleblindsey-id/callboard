-- 132_parts_queue_perf.sql
--
-- Small, safe DB-side hygiene for the parts_order_queue view path. These are
-- NOT the main performance lever (investigation 2026-06-22 showed the database
-- is ~96% idle and the view executes in single-digit ms server-side; the felt
-- slowness is cross-region network latency between the Vercel functions in
-- us-east and this database in us-west-2, plus per-page request waterfalls).
-- These two changes are still worth doing because they remove a wrong-index
-- join and an un-cacheable function call inside an RLS policy.

-- 1. Equality-join support for the parts_order_queue view's products join.
--    The view matches `products.number::text = part.product_number`, but the
--    only index on products.number is a trigram GIN (idx_products_number_trgm),
--    which the planner mis-uses for equality. A btree serves equality directly.
--    products.number is `character varying`, so a plain btree covers the cast.
CREATE INDEX IF NOT EXISTS idx_products_number ON public.products (number);

-- 2. get_tech_equipment_ids() is declared VOLATILE but is used inside the
--    technician RLS policies on pm_tickets / service_tickets
--    (`equipment_id IN (SELECT get_tech_equipment_ids())`). VOLATILE forces
--    re-evaluation; the result is stable within a single statement. STABLE lets
--    the planner evaluate it once per query. SECURITY DEFINER is unchanged.
ALTER FUNCTION public.get_tech_equipment_ids() STABLE;
