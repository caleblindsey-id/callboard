-- Migration 114: Estimate follow-up tracking
-- Gives the office a tracked, accountable path for service estimates sitting in
-- the 'estimated' state: when the estimate was submitted (the follow-up aging
-- clock), whether/when it was emailed (first send stays manual, re-sends are
-- automated), how many times, and a logged phone-contact attempt. All adds are
-- nullable / defaulted and non-breaking; the queue page, contact logging,
-- dashboard card, and re-notify cron (later rounds) are pure app code on top of
-- these columns. Mirrors the 100 ready-for-pickup tracking pattern.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS estimated_at             TIMESTAMPTZ,                 -- entered 'estimated' (follow-up aging clock)
  ADD COLUMN IF NOT EXISTS estimate_last_emailed_at TIMESTAMPTZ,                 -- most recent estimate email (manual or cron)
  ADD COLUMN IF NOT EXISTS estimate_notify_count    INTEGER NOT NULL DEFAULT 0,  -- total estimate emails sent
  ADD COLUMN IF NOT EXISTS estimate_called_at       TIMESTAMPTZ,                 -- office phone-contact log
  ADD COLUMN IF NOT EXISTS estimate_called_by_id    UUID,                        -- who logged the call
  ADD COLUMN IF NOT EXISTS estimate_contact_notes   TEXT;

-- FK matching the 027/100 convention (named, references users).
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_estimate_called_by_id_fkey
    FOREIGN KEY (estimate_called_by_id) REFERENCES users(id);

-- Partial index drives the estimate follow-up queue + (R4) the re-notify scanner
-- cheaply — only the handful of tickets actually awaiting a decision.
CREATE INDEX IF NOT EXISTS idx_service_tickets_estimated
  ON service_tickets(estimated_at)
  WHERE status = 'estimated';

-- Backfill in-flight estimates so the aging clock isn't NULL on day one.
UPDATE service_tickets
  SET estimated_at = COALESCE(updated_at, now())
  WHERE status = 'estimated' AND estimated_at IS NULL;

COMMENT ON COLUMN service_tickets.estimated_at IS
  'When the ticket entered the estimated state; aging anchor for the estimate follow-up queue.';
COMMENT ON COLUMN service_tickets.estimate_notify_count IS
  'Count of estimate-approval emails sent (manual first send + automated cron re-sends).';
