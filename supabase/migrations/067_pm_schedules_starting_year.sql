-- Migration 067: starting_year on pm_schedules.
--
-- The auto-backfill flow (shipped in 066-era CallBoard / Compass plan
-- `pm-scheduler-backfill`) hardcoded the backfill window to Jan 1 of the
-- current calendar year. That works for schedules whose cycle truly began
-- this year, but it silently invents PMs when a user adds a long-running
-- schedule for older equipment.
--
-- starting_year makes the first-PM year explicit. Paired with a 3-month
-- recency gate in the route handler (POST /api/pm-schedules), it doubles
-- as a guardrail: schedules whose first PM date is more than 3 months in
-- the past are recorded but not auto-backfilled.
--
-- Existing rows are backfilled to the current calendar year per Caleb's
-- direction — uniform and simple, no per-row guessing from created_at.

ALTER TABLE pm_schedules
  ADD COLUMN starting_year INT;

UPDATE pm_schedules
SET starting_year = EXTRACT(YEAR FROM now())::int
WHERE starting_year IS NULL;

ALTER TABLE pm_schedules
  ALTER COLUMN starting_year SET NOT NULL,
  ALTER COLUMN starting_year SET DEFAULT EXTRACT(YEAR FROM now())::int,
  ADD CONSTRAINT pm_schedules_starting_year_check
    CHECK (starting_year BETWEEN 2000 AND 2100);
