-- 165: why a match candidate was turned down.
--
-- Rejecting a tech lead requires a reason. Cancelling one requires a reason.
-- Dismissing an equipment-sale match candidate -- the decision that actually
-- determines whether a technician gets paid a bonus -- required nothing, so the
-- audit trail could say who dismissed it and when, but never why.
--
-- Nullable on purpose: every existing dismissal predates this column, and the
-- "dismiss all" sweep that fires when a manager corrects a lead's customer is a
-- housekeeping action with no human reason behind it.

ALTER TABLE equipment_sale_lead_candidates
  ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;

COMMENT ON COLUMN equipment_sale_lead_candidates.dismissed_reason IS
  'Free text: why this candidate was not the tech''s sale. Set on dismissal only; '
  'NULL for pre-2026-09 dismissals and for automatic sibling/housekeeping sweeps.';
