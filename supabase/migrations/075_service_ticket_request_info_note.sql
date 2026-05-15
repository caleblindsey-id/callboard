-- 074 — Service ticket request_info_note
--
-- Adds a manager-authored note explaining what additional detail is needed
-- when sending an estimate back to the tech for revision. Set when a manager
-- clicks "Request More Info" on an estimated ticket (transitions status →
-- 'open' but preserves the estimate fields). Cleared when the tech resubmits
-- the estimate (status → 'estimated').
--
-- Round B (U2/M1/U7) — paired with `/api/service-tickets/[id]/request-info`.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS request_info_note text;

COMMENT ON COLUMN service_tickets.request_info_note IS
  'Manager note shown to tech when an estimate is sent back for revision. Cleared on resubmit.';
