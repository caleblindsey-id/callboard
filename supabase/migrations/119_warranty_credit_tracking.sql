-- Migration 119: Warranty claim credit tracking
-- A warranty (or partial-warranty) repair isn't billed when the work is done — the
-- branch files a claim with the vendor/manufacturer and waits for the credit that
-- offsets the covered parts before closing it out. Today that lifecycle lives in
-- someone's head, so a filed-but-uncredited claim can stall indefinitely. These
-- columns give the warranty-claims worklist an accountable shape: which vendor,
-- the vendor's claim/RMA number, when the claim was filed (aging clock), the
-- expected credit, and when/how much credit actually came back. All adds are
-- nullable / non-breaking; the queue page, the credit actions, the dashboard card,
-- and the completed->billed credit gate are pure app code on top of these.
-- Mirrors the 114/118 follow-up patterns.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS warranty_vendor              TEXT,         -- manufacturer / vendor the claim is filed with
  ADD COLUMN IF NOT EXISTS warranty_claim_number        TEXT,         -- vendor's claim / RMA reference
  ADD COLUMN IF NOT EXISTS warranty_claim_submitted_at  TIMESTAMPTZ,  -- claim filed with the vendor (awaiting-credit aging clock)
  ADD COLUMN IF NOT EXISTS warranty_claim_submitted_by_id UUID,       -- who filed it
  ADD COLUMN IF NOT EXISTS warranty_credit_expected     NUMERIC,      -- credit amount the vendor is expected to issue
  ADD COLUMN IF NOT EXISTS warranty_credit_received_at  TIMESTAMPTZ,  -- vendor credit received (clears the billing gate)
  ADD COLUMN IF NOT EXISTS warranty_credit_received_by_id UUID,       -- who logged the credit
  ADD COLUMN IF NOT EXISTS warranty_credit_amount       NUMERIC;      -- actual credit received

-- FKs matching the 114/118 convention (named, reference users).
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_warranty_claim_submitted_by_id_fkey
    FOREIGN KEY (warranty_claim_submitted_by_id) REFERENCES users(id);
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_warranty_credit_received_by_id_fkey
    FOREIGN KEY (warranty_credit_received_by_id) REFERENCES users(id);

-- Partial index drives the warranty-claims worklist + dashboard count cheaply —
-- only completed warranty repairs whose vendor credit hasn't landed yet.
CREATE INDEX IF NOT EXISTS idx_service_tickets_warranty_open_credit
  ON service_tickets(warranty_claim_submitted_at)
  WHERE billing_type IN ('warranty', 'partial_warranty')
    AND status = 'completed'
    AND warranty_credit_received_at IS NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN service_tickets.warranty_claim_submitted_at IS
  'When the warranty claim was filed with the vendor; aging anchor for the awaiting-credit bucket.';
COMMENT ON COLUMN service_tickets.warranty_credit_received_at IS
  'When the vendor credit was received; clears the completed->billed gate for warranty tickets.';
