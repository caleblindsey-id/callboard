-- Add industrial and vacuum labor rate settings
INSERT INTO settings (key, value) VALUES ('industrial_labor_rate_per_hour', '120')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('vacuum_labor_rate_per_hour', '120')
  ON CONFLICT (key) DO NOTHING;

-- Add labor_rate_type to service_tickets (existing rows default to standard)
ALTER TABLE service_tickets
  ADD COLUMN labor_rate_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (labor_rate_type IN ('standard', 'industrial', 'vacuum'));

-- Add labor_rate_type to pm_tickets (existing rows default to standard)
ALTER TABLE pm_tickets
  ADD COLUMN labor_rate_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (labor_rate_type IN ('standard', 'industrial', 'vacuum'));
