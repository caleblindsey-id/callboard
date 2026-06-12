-- Pre-authorized repairs: allow a non-warranty service ticket to start work
-- without an estimate. The marker distinguishes "started without an estimate"
-- from the normal open -> estimated -> approved -> in_progress flow; the
-- authorizer (who told us to proceed) is recorded in manual_decision_note.
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS estimate_bypassed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN service_tickets.estimate_bypassed IS
  'TRUE when a non-warranty repair started work without an estimate (pre-authorized). Authorizer recorded in manual_decision_note.';
