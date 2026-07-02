-- Verified-existence stamp for a separately-invoiced diagnostic fee.
--
-- Policy (2026-07-02): the customer-facing estimate (approval page, estimate
-- email, estimate PDF) shows the diagnostic fee as a CREDIT only when the
-- Synergy invoice number on the ticket has been verified to exist in Synergy
-- (invh.KeyInvCMNo). Until verification lands, the fee renders as a positive
-- charge — the conservative direction. The nightly validator
-- (scripts/sync/validate-synergy-orders.py) and the on-demand revalidation
-- queue drain both stamp these columns; the app never writes them.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS diagnostic_invoice_validation_status text
    CHECK (diagnostic_invoice_validation_status IN ('valid', 'invalid')),
  ADD COLUMN IF NOT EXISTS diagnostic_invoice_validated_at timestamptz;

COMMENT ON COLUMN service_tickets.diagnostic_invoice_validation_status IS
  'Nightly Synergy check of diagnostic_invoice_number against invh.KeyInvCMNo: valid / invalid / NULL (pending or no invoice #). Gates the estimate-surface diagnostic credit.';
