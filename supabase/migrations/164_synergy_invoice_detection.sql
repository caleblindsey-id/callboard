-- Migration 164: provenance columns for nightly Synergy invoice detection.
--
-- The nightly validator (validate-synergy-orders.py) now detects when an
-- entered Synergy sales order has been invoiced (roh.InvNum <> 0, or the
-- header moved to invh) and pre-fills synergy_invoice_number on the ticket.
-- These columns record when detection happened and that the number came from
-- the script ('auto') vs a person ('manual'), so the Awaiting Invoice queues
-- can show a "Synergy shows invoiced — confirm" pill. Billing gates do NOT
-- read these columns; Mark Billed still re-validates PO/warranty/CAS.

ALTER TABLE pm_tickets
  ADD COLUMN IF NOT EXISTS synergy_invoice_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synergy_invoice_source TEXT
    CHECK (synergy_invoice_source IN ('auto', 'manual'));

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS synergy_invoice_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synergy_invoice_source TEXT
    CHECK (synergy_invoice_source IN ('auto', 'manual'));

COMMENT ON COLUMN pm_tickets.synergy_invoice_detected_at IS
  'When the nightly validator found this ticket''s Synergy order invoiced and auto-filled synergy_invoice_number. NULL for manually keyed numbers.';
COMMENT ON COLUMN service_tickets.synergy_invoice_detected_at IS
  'When the nightly validator found this ticket''s Synergy order invoiced and auto-filled synergy_invoice_number. NULL for manually keyed numbers.';

NOTIFY pgrst, 'reload schema';
