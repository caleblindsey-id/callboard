-- Service ticket billing_type: rename 'time_and_materials' -> 'non_warranty'
-- Behavior unchanged (still "bill everything"); only the enum value + default + label change.

-- Defensive: migrate any existing rows before tightening the check constraint.
UPDATE service_tickets
SET billing_type = 'non_warranty'
WHERE billing_type = 'time_and_materials';

ALTER TABLE service_tickets
  DROP CONSTRAINT IF EXISTS service_tickets_billing_type_check;

ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_billing_type_check
  CHECK (billing_type IN ('non_warranty', 'warranty', 'partial_warranty'));

ALTER TABLE service_tickets
  ALTER COLUMN billing_type SET DEFAULT 'non_warranty';
