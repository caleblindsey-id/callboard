-- When a ticket was invoiced (marked billed). Powers the read-only Invoiced
-- archive on the billing page so completed+invoiced work orders can be referenced
-- after they leave the active billing queues. Stamped at every status->billed
-- transition (service + PM batch mark-billed routes and the single-ticket PATCH
-- routes); a reopen->re-bill overwrites it, so no reset-on-reopen is needed (a
-- reopened ticket is 'completed', not 'billed', so it's out of the archive until
-- re-stamped).
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE pm_tickets      ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

-- Backfill history so the archive isn't empty on day one. completed_at /
-- completed_date is the best available proxy for the invoice date on already-
-- billed rows (the true bill date wasn't recorded before this column).
UPDATE service_tickets SET billed_at = completed_at
  WHERE status = 'billed' AND billed_at IS NULL;
UPDATE pm_tickets SET billed_at = completed_date::timestamptz
  WHERE status = 'billed' AND billed_at IS NULL;

COMMENT ON COLUMN service_tickets.billed_at IS
  'When the ticket was marked billed (invoiced). Stamped at the status->billed transition; backfilled from completed_at for pre-migration billed rows.';
COMMENT ON COLUMN pm_tickets.billed_at IS
  'When the ticket was marked billed (invoiced). Stamped at the status->billed transition; backfilled from completed_date for pre-migration billed rows.';
