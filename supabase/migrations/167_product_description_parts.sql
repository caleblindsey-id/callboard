-- Migration 167: split Synergy's Desc1/Desc2 into their own product columns.
--
-- Background (feedback #96, Bob Brashears): techs need to see and search the
-- item codes that the office keeps in Synergy's *second* description field —
-- e.g. product 459006801 is Desc1 "NCL SPIT SHINE BURNISH 12/32QT" +
-- Desc2 "0576-36 HI-SPEED KLEEN & BURNI", where 0576-36 is the item code.
--
-- The data was never missing: sync_products() has concatenated the two fields
-- into the single `description` column since the first sync
-- (`f"{desc1} {desc2}".strip()`), which is why every description in this table
-- tops out at 61 chars = 30 + 1 + 30, the two ERP field widths. So Desc2 has
-- always been matched by the pickers' `description ILIKE '%q%'`.
--
-- What was missing is *separability*. Desc1 is not padded to 30, so the joined
-- string cannot be split back apart in the UI, and the item code ends up buried
-- mid-string with nothing marking it — and, because it sits at the tail, it is
-- the first thing an ellipsis eats in the compact single-line part rows.
--
-- So: keep `description` exactly as it is (every existing read, every stored
-- parts_requested/parts_used snapshot, and the 121 trigram index all keep
-- working untouched) and add the two halves alongside it. The UI shows Desc1 as
-- the primary line and Desc2 as its own labeled line, falling back to
-- `description` wherever the new columns are still NULL.
--
-- These columns stay NULL until the updated scripts/sync/synergy-sync.py runs
-- (hourly `--products-only` refresh). They cannot be backfilled from existing
-- data: splitting "desc1 desc2" back into its parts is ambiguous, since Desc1 is
-- variable-length. The fallback path above is what covers that window.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description_1 TEXT,
  ADD COLUMN IF NOT EXISTS description_2 TEXT;

COMMENT ON COLUMN products.description_1 IS
  'Synergy prod.Desc1, verbatim. NULL until the first sync after migration 167. Display falls back to products.description.';
COMMENT ON COLUMN products.description_2 IS
  'Synergy prod.Desc2, verbatim — carries the office''s item codes (feedback #96). NULL until the first sync after migration 167, and legitimately NULL for products that have no Desc2.';

-- Mirror of idx_products_description_trgm (migration 121). The part pickers add
-- `description_2 ILIKE '%q%'` to their .or(), and a leading-wildcard ILIKE can
-- only be index-backed by a trigram GIN — without this the new OR branch would
-- force a sequential scan over ~13k rows on every keystroke and undo exactly
-- what 121 fixed.
CREATE INDEX IF NOT EXISTS idx_products_description_2_trgm
  ON products USING GIN (description_2 gin_trgm_ops);
