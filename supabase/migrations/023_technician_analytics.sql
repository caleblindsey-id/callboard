-- Add hourly cost to users for profitability calculations
ALTER TABLE users ADD COLUMN hourly_cost DECIMAL;

-- Targets table for technician performance benchmarks
CREATE TABLE technician_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL,
  target_value    DECIMAL NOT NULL,
  period_type     TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate active targets for same tech/metric/period
CREATE UNIQUE INDEX uq_active_target
  ON technician_targets (technician_id, metric, period_type)
  WHERE active = true;

-- NULL technician_id = team-wide default, needs separate index
CREATE UNIQUE INDEX uq_active_team_target
  ON technician_targets (metric, period_type)
  WHERE active = true AND technician_id IS NULL;

CREATE INDEX idx_targets_technician ON technician_targets(technician_id);

ALTER TABLE technician_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage technician_targets"
  ON technician_targets FOR ALL TO authenticated
  USING (get_user_role() IN ('manager','coordinator'));
