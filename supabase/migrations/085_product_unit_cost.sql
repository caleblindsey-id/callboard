-- Add loaded cost to the product catalog so service-ticket pricing can enforce
-- a per-line gross-margin floor (price must keep >= 15% margin over loaded cost).
--
-- Source: Synergy prod.CostLoad (loaded cost = cost + allocated overhead), with
-- prod.CostPO (last PO cost) as a fallback. Populated by scripts/sync/synergy-sync.py.
-- Cost is internal/server-only — never returned on tech-facing reads.
--
-- Additive + nullable + idempotent. Existing rows stay NULL until the next sync,
-- and a NULL unit_cost means "cost unknown" (floor not enforced, flagged in UI).

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2);
