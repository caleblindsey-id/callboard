-- Customer billing notes: timestamped, append-only contact log keyed to a customer.
-- Office staff record outreach attempts (calls, emails) and customer responses
-- while working the billing list. Mirrors equipment_notes (migration 020), but the
-- FK is INT because customers.id is SERIAL.
CREATE TABLE customer_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  note_text   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_notes_customer_id ON customer_notes(customer_id);

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

-- Read for any authenticated user; the consuming pages (/billing, customer profile)
-- are manager-gated, and the POST route enforces MANAGER_ROLES for writes.
CREATE POLICY "Authenticated read customer_notes"
  ON customer_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert customer_notes"
  ON customer_notes FOR INSERT TO authenticated
  WITH CHECK (true);
