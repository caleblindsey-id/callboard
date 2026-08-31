-- Migration 161: billing_type frozen; sweep stragglers into the review lifecycle.
--
-- Round 4 of the warranty redesign retires billing_type as a write target
-- entirely (no more UI, no more TRANSITION SHIM on the create/PATCH routes).
-- Migration 160 already backfilled every pre-redesign warranty/partial_warranty
-- row into a verified review at deploy time; this is the final idempotent
-- sweep for anything written via the shim between 160 and this deploy, then
-- freezes the column with a comment so its historical meaning stays legible.
UPDATE service_tickets SET
  warranty_review_status        = 'verified',
  warranty_review_requested_at  = COALESCE(created_at, now()),
  warranty_review_decided_at    = COALESCE(completed_at, created_at, now()),
  warranty_review_decision_note = 'Backfilled from billing_type=' || billing_type,
  warranty_labor_covered        = (billing_type = 'warranty')
WHERE billing_type IN ('warranty','partial_warranty')
  AND warranty_review_status IS NULL;

UPDATE service_tickets SET customer_bill_amount = billing_amount
WHERE billing_type IN ('warranty','partial_warranty')
  AND customer_bill_amount IS NULL
  AND billing_amount IS NOT NULL;

COMMENT ON COLUMN service_tickets.billing_type IS
  'FROZEN 2026-08: replaced by warranty_review_status (migration 160). New rows always non_warranty; historical warranty/partial_warranty rows keep their meaning (their billing_amount was the reduced customer amount).';
