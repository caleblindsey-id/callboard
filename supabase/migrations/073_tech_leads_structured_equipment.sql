-- Migration 073: Structured equipment fields + proposed-start month/year on tech_leads.
--
-- Per feedback #4 (Mike Jennings): the PM lead submit form's single free-text
-- "Equipment" textarea makes the resulting rep email and the manager
-- create-equipment flow do a lot of guessing. Split it into discrete columns
-- — make, model, serial_number, location_on_site — and add a required
-- proposed start month/year so the office has a concrete follow-up hook.
--
-- equipment_description stays NOT NULL: the API auto-composes it from the
-- structured fields on insert so downstream consumers (rep email template,
-- /my-leads sub-line, legacy queries) keep rendering. We may drop or relax
-- it in a future migration once the structured fields are fully wired.
--
-- Legacy rows (PM leads created before this migration) keep their NULL
-- structured fields. The PM-required gate uses a created_at cutoff so the
-- new constraint only binds rows created after the migration runs.

ALTER TABLE tech_leads
  ADD COLUMN IF NOT EXISTS make                 TEXT,
  ADD COLUMN IF NOT EXISTS model                TEXT,
  ADD COLUMN IF NOT EXISTS serial_number        TEXT,
  ADD COLUMN IF NOT EXISTS location_on_site     TEXT,
  ADD COLUMN IF NOT EXISTS proposed_start_month INT,
  ADD COLUMN IF NOT EXISTS proposed_start_year  INT;

ALTER TABLE tech_leads
  DROP CONSTRAINT IF EXISTS tech_leads_make_len,
  DROP CONSTRAINT IF EXISTS tech_leads_model_len,
  DROP CONSTRAINT IF EXISTS tech_leads_serial_len,
  DROP CONSTRAINT IF EXISTS tech_leads_location_len,
  DROP CONSTRAINT IF EXISTS tech_leads_proposed_start_month_chk,
  DROP CONSTRAINT IF EXISTS tech_leads_proposed_start_year_chk,
  DROP CONSTRAINT IF EXISTS tech_leads_pm_structured_chk;

ALTER TABLE tech_leads
  ADD CONSTRAINT tech_leads_make_len
    CHECK (make IS NULL OR char_length(make) <= 200),
  ADD CONSTRAINT tech_leads_model_len
    CHECK (model IS NULL OR char_length(model) <= 200),
  ADD CONSTRAINT tech_leads_serial_len
    CHECK (serial_number IS NULL OR char_length(serial_number) <= 200),
  ADD CONSTRAINT tech_leads_location_len
    CHECK (location_on_site IS NULL OR char_length(location_on_site) <= 200),
  ADD CONSTRAINT tech_leads_proposed_start_month_chk
    CHECK (proposed_start_month IS NULL OR proposed_start_month BETWEEN 1 AND 12),
  ADD CONSTRAINT tech_leads_proposed_start_year_chk
    CHECK (proposed_start_year IS NULL OR proposed_start_year BETWEEN 2000 AND 2100);

-- PM leads created after this migration runs must carry the structured fields
-- (make / model / serial_number / proposed_start_month / proposed_start_year).
-- Location is intentionally optional per the original request. Rows created
-- before the migration ran are grandfathered as-is — the cutoff is captured
-- per-environment at migration time via dynamic SQL, so previews and prod
-- each get their own correct boundary instead of a shared hardcoded date.
DO $$
DECLARE
  cutoff TIMESTAMPTZ := now();
BEGIN
  EXECUTE format(
    'ALTER TABLE tech_leads ADD CONSTRAINT tech_leads_pm_structured_chk CHECK (
       lead_type <> ''pm''
       OR created_at < %L::TIMESTAMPTZ
       OR (
         make IS NOT NULL AND char_length(trim(make)) > 0
         AND model IS NOT NULL AND char_length(trim(model)) > 0
         AND serial_number IS NOT NULL AND char_length(trim(serial_number)) > 0
         AND proposed_start_month IS NOT NULL
         AND proposed_start_year IS NOT NULL
       )
     )',
    cutoff
  );
END $$;

COMMENT ON COLUMN tech_leads.make IS
  'Equipment make (PM leads from migration 073 onward — required).';
COMMENT ON COLUMN tech_leads.model IS
  'Equipment model (PM leads from migration 073 onward — required).';
COMMENT ON COLUMN tech_leads.serial_number IS
  'Equipment serial number (PM leads from migration 073 onward — required).';
COMMENT ON COLUMN tech_leads.location_on_site IS
  'Where the equipment sits on site (optional).';
COMMENT ON COLUMN tech_leads.proposed_start_month IS
  'Tech-proposed first-PM month (1–12). Pre-fills anchor_month when the manager creates the schedule.';
COMMENT ON COLUMN tech_leads.proposed_start_year IS
  'Tech-proposed first-PM year. Pre-fills pm_schedules.starting_year when the manager creates the schedule.';
