-- Migration 160: Warranty review lifecycle.
--
-- Warranty moves from a pricing switch (billing_type) to a review -> claim ->
-- reconcile lifecycle. Tickets always complete at full price (billing_amount
-- stays the full-price claim artifact the vendor requires); the office verifies
-- coverage, files the claim, and reconciles the vendor credit line-by-line.
-- customer_bill_amount carries the post-coverage customer total; NULL means
-- "same as billing_amount". billing_type is frozen (default non_warranty) and
-- replaced by warranty_review_status; existing warranty rows are backfilled
-- below so the queue, gate, and digest stay coherent mid-rollout.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS warranty_review_status TEXT
      CHECK (warranty_review_status IN ('requested','verified','denied')),
  ADD COLUMN IF NOT EXISTS warranty_review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warranty_review_requested_by_id UUID,
  ADD COLUMN IF NOT EXISTS warranty_review_note TEXT,
  ADD COLUMN IF NOT EXISTS warranty_review_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warranty_review_decided_by_id UUID,
  ADD COLUMN IF NOT EXISTS warranty_review_decision_note TEXT,
  ADD COLUMN IF NOT EXISTS warranty_vendor_labor_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS warranty_labor_credit_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS customer_bill_amount NUMERIC;

ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_warranty_review_requested_by_id_fkey
    FOREIGN KEY (warranty_review_requested_by_id) REFERENCES users(id);
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_warranty_review_decided_by_id_fkey
    FOREIGN KEY (warranty_review_decided_by_id) REFERENCES users(id);

-- Worklist index: covers every queue bucket including the billed-unclaimed leg
-- that the 119 partial index missed. Tiny: only flagged tickets qualify.
CREATE INDEX IF NOT EXISTS idx_service_tickets_warranty_worklist
  ON service_tickets (warranty_review_status, status, warranty_claim_submitted_at)
  WHERE warranty_review_status IS NOT NULL AND deleted_at IS NULL;

-- Backfill: every existing warranty/partial ticket becomes a verified review.
-- billing_type='warranty' meant the whole job (labor included) was covered.
UPDATE service_tickets SET
  warranty_review_status        = 'verified',
  warranty_review_requested_at  = COALESCE(created_at, now()),
  warranty_review_decided_at    = COALESCE(completed_at, created_at, now()),
  warranty_review_decision_note = 'Backfilled from billing_type=' || billing_type,
  warranty_labor_covered        = (billing_type = 'warranty')
WHERE billing_type IN ('warranty','partial_warranty')
  AND warranty_review_status IS NULL;

-- Historical coherence: pre-redesign warranty rows already billed the customer
-- at the reduced amount, so their customer bill IS their billing_amount.
UPDATE service_tickets SET customer_bill_amount = billing_amount
WHERE billing_type IN ('warranty','partial_warranty')
  AND customer_bill_amount IS NULL;

COMMENT ON COLUMN service_tickets.warranty_review_status IS
  'Warranty review lifecycle: NULL = never flagged/unflagged, requested = awaiting office verification, verified = coverage confirmed, denied = bills full price.';
COMMENT ON COLUMN service_tickets.warranty_vendor_labor_rate IS
  'Vendor''s warranty labor rate ($/hr) entered by the office; used to suggest the expected credit.';
COMMENT ON COLUMN service_tickets.warranty_labor_credit_amount IS
  'Actual labor credit from the vendor, entered at line-level reconcile.';
COMMENT ON COLUMN service_tickets.customer_bill_amount IS
  'Final customer total after warranty coverage: billing_amount minus covered lines. NULL = same as billing_amount. billing_amount itself stays the full-price claim artifact.';
