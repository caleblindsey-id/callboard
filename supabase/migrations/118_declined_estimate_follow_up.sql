-- Migration 118: Declined-estimate follow-up tracking
-- A declined estimate used to vanish into the "Declined" board tab with no owner.
-- This gives the office an accountable worklist: when the estimate was declined
-- (the aging clock) and whether a manager has handled it (re-quoted, called the
-- customer, or decided to let it go). "Handled" is a soft dismissal — it removes
-- the ticket from the active worklist WITHOUT changing ticket status, since
-- declined → open is the only real transition (a reopen is a full re-quote).
-- All adds are nullable / defaulted and non-breaking; the queue page, the
-- resolve action, and the dashboard card are pure app code on top of these.
-- Mirrors the 114 estimate follow-up pattern.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS declined_at           TIMESTAMPTZ,  -- entered 'declined' (follow-up aging clock)
  ADD COLUMN IF NOT EXISTS decline_resolved_at   TIMESTAMPTZ,  -- a manager marked the decline handled
  ADD COLUMN IF NOT EXISTS decline_resolved_by_id UUID;        -- who handled it

-- FK matching the 027/114 convention (named, references users).
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_decline_resolved_by_id_fkey
    FOREIGN KEY (decline_resolved_by_id) REFERENCES users(id);

-- Partial index drives the declined worklist + dashboard count cheaply — only the
-- handful of declined estimates still awaiting an office decision.
CREATE INDEX IF NOT EXISTS idx_service_tickets_declined
  ON service_tickets(declined_at)
  WHERE status = 'declined' AND decline_resolved_at IS NULL;

-- Backfill already-declined estimates so the aging clock isn't NULL on day one.
UPDATE service_tickets
  SET declined_at = COALESCE(updated_at, now())
  WHERE status = 'declined' AND declined_at IS NULL;

COMMENT ON COLUMN service_tickets.declined_at IS
  'When the ticket entered the declined state; aging anchor for the declined follow-up queue.';
COMMENT ON COLUMN service_tickets.decline_resolved_at IS
  'When a manager marked the declined estimate handled; removes it from the active worklist without changing status.';
