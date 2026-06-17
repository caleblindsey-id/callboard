-- Migration 121: pg_trgm GIN indexes for the products search.
-- The parts/product search (useProductSearch, PartsEntryList, PartSynergyPicker,
-- renderPartsSection) runs `number ILIKE '%q%' OR description ILIKE '%q%'` on every
-- keystroke. Neither column was indexed, and the leading-wildcard pattern cannot use
-- a btree even if it were, so every search sequential-scanned the whole catalog
-- (~13k rows) — confirmed 2026-06-17 burning the small-instance disk-IO budget and
-- amplifying the login-outage connection pileup. Trigram GIN indexes make ILIKE '%q%'
-- index-backed (BitmapOr across the two indexes). Additive, no app change required.
--
-- Verified on prod 2026-06-17: the search query flipped from
--   Seq Scan on products (Rows Removed by Filter: 3475), 9.2 ms
-- to
--   Bitmap Heap Scan -> BitmapOr over idx_products_number_trgm + idx_products_description_trgm
--   (Heap Blocks: exact=11), 0.4 ms.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_number_trgm
  ON products USING GIN (number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_description_trgm
  ON products USING GIN (description gin_trgm_ops);
