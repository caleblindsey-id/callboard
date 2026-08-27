-- Migration 163: extend the PO follow-up log to PM tickets and add the PM
-- parity columns the unified Billing Chase worklist needs.
--
-- po_follow_ups (140) was service-only (ticket_id -> service_tickets). The
-- worklist now chases POs on BOTH ticket types, so the table goes polymorphic
-- using the credit_reviews (077) pattern: ticket_type discriminator + two
-- nullable FKs + exactly-one CHECK + type-matches-ref CHECK.
--
-- RLS: unchanged — the existing policies never reference the ticket columns
-- (read = any authenticated; insert = author is caller AND manager role).

-- Rename for symmetry with pm_ticket_id (matches credit_reviews naming).
ALTER TABLE po_follow_ups RENAME COLUMN ticket_id TO service_ticket_id;
ALTER INDEX idx_po_follow_ups_ticket_id RENAME TO idx_po_follow_ups_service_ticket_id;

ALTER TABLE po_follow_ups ALTER COLUMN service_ticket_id DROP NOT NULL;
ALTER TABLE po_follow_ups
  ADD COLUMN pm_ticket_id UUID REFERENCES pm_tickets(id) ON DELETE CASCADE;
ALTER TABLE po_follow_ups
  ADD COLUMN ticket_type TEXT NOT NULL DEFAULT 'service'
    CHECK (ticket_type IN ('pm', 'service'));

-- Exactly one ticket reference, and it must match ticket_type.
ALTER TABLE po_follow_ups ADD CONSTRAINT po_follow_ups_one_ticket CHECK (
  (service_ticket_id IS NOT NULL)::int + (pm_ticket_id IS NOT NULL)::int = 1
);
ALTER TABLE po_follow_ups ADD CONSTRAINT po_follow_ups_type_matches_ref CHECK (
  (ticket_type = 'service' AND service_ticket_id IS NOT NULL) OR
  (ticket_type = 'pm'      AND pm_ticket_id IS NOT NULL)
);

CREATE INDEX idx_po_follow_ups_pm_ticket_id
  ON po_follow_ups(pm_ticket_id) WHERE pm_ticket_id IS NOT NULL;

-- PM parity columns. po_last_* mirror service (140); billing_exported_at
-- mirrors service (106) and anchors the "entered but not invoiced" aging in
-- the nightly invoice-detection round.
ALTER TABLE pm_tickets
  ADD COLUMN IF NOT EXISTS po_last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_last_method TEXT,
  ADD COLUMN IF NOT EXISTS billing_exported_at TIMESTAMPTZ;

COMMENT ON COLUMN pm_tickets.po_last_contacted_at IS
  'Most recent po_follow_ups.contacted_at for this ticket; drives the Billing Chase worklist recency. Maintained by the follow-up POST route.';
COMMENT ON COLUMN pm_tickets.po_last_method IS
  'Method of the most recent po_follow_ups entry (call/email/text/other). Denormalized for the worklist row. Maintained by the follow-up POST route.';
COMMENT ON COLUMN pm_tickets.billing_exported_at IS
  'When the billing PDF export flipped billing_exported=true. Parity with service_tickets (106); anchors entered-but-not-invoiced aging.';

NOTIFY pgrst, 'reload schema';
