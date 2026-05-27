-- Structured PM skip requests: capture a reason category, the customer's
-- recommended next-PM month/year, and whether the equipment is still on site.
-- All additive + nullable. Existing skip_reason now holds optional free-text
-- notes; legacy rows (skip_reason populated, category NULL) render via the
-- manager-review fallback.

ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS skip_reason_category   TEXT;
ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS skip_recommended_month INT;
ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS skip_recommended_year  INT;
ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS skip_equipment_on_site BOOLEAN;

-- Guard the recommended month to a valid 1-12 range (NULL allowed: no recommendation).
ALTER TABLE pm_tickets DROP CONSTRAINT IF EXISTS pm_tickets_skip_rec_month_check;
ALTER TABLE pm_tickets ADD CONSTRAINT pm_tickets_skip_rec_month_check
  CHECK (skip_recommended_month IS NULL OR skip_recommended_month BETWEEN 1 AND 12);
