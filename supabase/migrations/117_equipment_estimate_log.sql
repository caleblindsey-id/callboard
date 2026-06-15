-- Permanent per-equipment estimate snapshot. Written at the moment a service
-- estimate is DECLINED (customer self-serve link or staff decline) so a unit
-- that comes back later always shows what was previously quoted and why it died
-- — "we estimated $X to fix Y last time, customer declined."
--
-- This is a durable SNAPSHOT on purpose: reopening a declined ticket clears its
-- decline_reason and flips it back to 'open' (see PATCH /api/service-tickets/[id]),
-- so a live view of declined tickets would vanish on re-quote. A copied row
-- survives every later ticket state change.
--
-- One row per decline event. Rows are written server-side under the service-role
-- key (the decline caller is the customer or a manager, not a row owner), so
-- there is no INSERT policy — RLS only scopes authenticated staff reads.

CREATE TABLE IF NOT EXISTS equipment_estimate_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id        UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  service_ticket_id   UUID,
  work_order_number   INTEGER,
  estimate_amount     NUMERIC(12,2),
  problem_description TEXT,
  diagnosis_notes     TEXT,
  outcome             TEXT NOT NULL DEFAULT 'declined',
  decline_reason      TEXT,
  technician_id       UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-equipment history query: newest estimate first.
CREATE INDEX IF NOT EXISTS idx_equipment_estimate_log_equipment_created
  ON equipment_estimate_log(equipment_id, created_at DESC);

ALTER TABLE equipment_estimate_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated staff member reads the estimate history (it shows on the
-- equipment detail page, visible to managers + technicians). The service-role
-- writer bypasses RLS, so no INSERT policy is granted to clients.
DROP POLICY IF EXISTS equipment_estimate_log_select ON equipment_estimate_log;
CREATE POLICY equipment_estimate_log_select ON equipment_estimate_log
  FOR SELECT TO authenticated USING (true);
