-- Add a manually-curated "requires_detail" flag to products.
--
-- Catch-all catalog items (e.g. 444444970 "SHOP SUPPLIES") are generic billing
-- lines — neither the office nor the customer can tell what was actually used.
-- When this flag is set, the CallBoard parts-entry form surfaces a free-text
-- "Details" input so the tech can describe the supplies (e.g. "rags, lubricant,
-- fasteners"); that detail is stored on the part JSONB and rendered in-line on
-- customer-facing PDFs/views.
--
-- IMPORTANT: this flag is curated by hand, NOT written by the nightly Synergy
-- products sync (scripts/sync/synergy-sync.py upserts only synergy_id, number,
-- description, unit_price). Because the sync payload omits requires_detail, the
-- ON CONFLICT update leaves it untouched and the flag sticks across syncs.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS requires_detail BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed the first flagged item: SHOP SUPPLIES.
UPDATE products SET requires_detail = TRUE WHERE synergy_id = '444444970';
