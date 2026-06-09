-- Carry each catalog item's branch stock position onto the product record so the
-- new parts-queue "Review" step can show the office what we already have on hand
-- and what's already inbound on a PO — the signal that lets them decide
-- "pull from stock" vs "order" instead of re-ordering parts we already stock.
--
-- Source (Synergy, populated by scripts/sync/synergy-sync.py):
--   qty_on_hand <- prodwhse.QtyOnHand  (units physically on hand)
--   qty_on_po   <- prodwhse.QtyOnPO    (units inbound on open purchase orders)
--   ...both for Whse = 1 (Birmingham — the service department's bench stock;
--   verified the dominant warehouse: 10,305 rows / ~202k on-hand vs the next
--   warehouse's ~44k). A part stocked only at Montgomery/Tuscaloosa is correctly
--   NOT counted as in-stock for a Birmingham bench repair.
--
-- NOTE: do NOT source qty_on_po from rolnew — that's *sales*-order lines
-- (outbound customer demand), the opposite of inbound supply. Synergy has a
-- purpose-built prodwhse.QtyOnPO column right next to QtyOnHand; use it.
--
-- Synergy stores these as signed ints (QtyOnHand can go negative when oversold),
-- so INTEGER, nullable. NULL = "no stock record at Whse 1 / unknown" (a
-- non-catalog / never-stocked part). Existing rows stay NULL until the next sync.
-- Additive + idempotent — safe on tech-facing reads (stock levels aren't secret).

ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_on_hand INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_on_po INTEGER;
