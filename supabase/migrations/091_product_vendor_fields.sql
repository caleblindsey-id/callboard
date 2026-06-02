-- Carry each catalog item's primary vendor + vendor part # onto the product
-- record so the service-ticket "Request Part" form can prefill them when a tech
-- picks a stock item (techs rarely know the manufacturer/vendor part number).
--
-- Source (Synergy, populated by scripts/sync/synergy-sync.py):
--   vendor_code      <- prod.PrimVend (primary vendor; joins a80vm.VendorCode)
--   vendor           <- a80vm.Name    (vendor display name, via LEFT JOIN)
--   vendor_item_code <- prod.VendItem (vendor / manufacturer part number)
--
-- Verified one-vendor-per-product in the ERP: prod.PrimVend is 100% populated on
-- parts and joins 100% to the vendor master, so there's no ambiguity to resolve.
--
-- Additive + nullable + idempotent. Existing rows stay NULL until the next sync.
-- Not cost-derived (unlike unit_cost), so these are safe on tech-facing reads.

ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_code INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_item_code TEXT;
