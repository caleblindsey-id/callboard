-- 106_service_billing_exported.sql
-- Make service-ticket billing flow like PM billing: add the export-first phase.
--
-- PM tickets have a two-phase billing flow — a completed ticket is first
-- "exported" (manager pulls the billing document, billing_exported flips true but
-- status stays 'completed'), then moves to an "Awaiting Invoice #" queue where the
-- coordinator keys the SynergyERP invoice # and marks it billed. Service tickets
-- previously skipped the export phase entirely. This column adds that gate so a
-- service ticket must be exported before its invoice # can be keyed (mirrors
-- pm_tickets.billing_exported).
--
-- billing_exported_at records when the export happened (audit; PM has no analog
-- but it's cheap and useful for the service flow).

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS billing_exported boolean NOT NULL DEFAULT false;

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS billing_exported_at timestamptz;

-- One-time cutover backfill: every service ticket already sitting in 'completed'
-- was keyed/billed under the old single-list flow. Treat them as already exported
-- so the new export gate applies ONLY to go-forward completions — this keeps any
-- in-flight billing (tickets already keyed with an invoice #, awaiting Mark Billed)
-- exactly where it is instead of yanking it back behind a new export step.
UPDATE service_tickets
  SET billing_exported = true
  WHERE status = 'completed' AND billing_exported = false;

-- Reload PostgREST schema cache so the new column is selectable over REST
-- immediately (the app selects it in the billing queries).
NOTIFY pgrst, 'reload schema';
