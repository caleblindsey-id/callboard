-- Migration 151: four-month PM leads earn 75% of the flat rate
--
-- Updates the earn trigger last set by the 2026-06-04 migration
-- `tech_lead_four_month_75pct_bonus` (ledger version 20260604205716), whose .sql file
-- is MISSING from this repo. That migration is applied to BOTH prod and dev and already
-- pays 0.75 at interval 4, so this file is a no-op against those databases. Verified
-- against live pg_proc on both, 2026-07-31. It is kept because it restores the missing
-- file to the repo and records the annual-pays-nothing ruling in the function comment.
-- Do NOT assume from the file list alone that a rule is unimplemented; check the ledger.
--
-- The written commission plan ("Outside Service Technician Commission Structure",
-- effective 2022-11-01) pays the PM sale bonus on PMs PER YEAR:
--
--     4 or more a year = 100% of the PM total
--     3 a year         =  75%
--     2 a year         =  50%
--     1 a year         =  25%   (see note below)
--
-- Schedules store an interval in MONTHS, so 3 PMs a year is interval_months = 4.
-- That case has paid NOTHING since launch -- the 75% rule was never implemented.
-- This migration fixes it. Verified against the plan document 2026-07-31.
--
-- NOTE ON ANNUAL: the plan says 1-a-year should pay 25%. Caleb ruled on 2026-07-31
-- that annual pays nothing, so interval 12 stays at zero and the plan text is stale
-- on that point. Do not "fix" it to 25% without asking.
--
-- FORWARD-ONLY, deliberately. This fires on the next PM completion for any approved,
-- unearned lead. Leads on four-month schedules whose first PM already completed did
-- not earn and are NOT backfilled here -- the trigger is AFTER UPDATE OF status and
-- cannot see the past. Backfilling those is a separate, reviewed data change.
--
-- CREATE OR REPLACE updates the function the existing trigger already calls, so the
-- trigger itself does not need to be recreated.

CREATE OR REPLACE FUNCTION earn_tech_lead_on_pm_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_interval_months INT;
  v_billing_type    TEXT;
  v_flat_rate       DECIMAL(10,2);
  v_rate            NUMERIC;
BEGIN
  -- Redundant with the WHEN clause on the trigger, but keep belt+suspenders.
  IF NEW.equipment_id IS NULL OR NEW.pm_schedule_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT interval_months, billing_type, flat_rate
    INTO v_interval_months, v_billing_type, v_flat_rate
  FROM pm_schedules
  WHERE id = NEW.pm_schedule_id;

  -- Eligibility: flat_rate billing, non-zero rate, and a bonus-bearing interval.
  IF v_interval_months IS NULL
     OR v_interval_months NOT IN (1, 2, 3, 4, 6)
     OR v_billing_type <> 'flat_rate'
     OR v_flat_rate IS NULL
     OR v_flat_rate <= 0 THEN
    RETURN NEW;
  END IF;

  v_rate := CASE
              WHEN v_interval_months IN (1, 2, 3) THEN 1.0    -- 4+ PMs/yr: full
              WHEN v_interval_months = 4          THEN 0.75   -- 3 PMs/yr
              ELSE                                     0.5    -- interval 6: 2 PMs/yr
            END;

  -- Earn the lead if one is waiting. Unique index on tech_leads(equipment_id)
  -- guarantees at most one. earned_at IS NULL guard makes this idempotent.
  UPDATE tech_leads
  SET
    status                = 'earned',
    earned_at             = now(),
    earned_from_ticket_id = NEW.id,
    bonus_amount          = ROUND(v_flat_rate * v_rate, 2)
  WHERE equipment_id = NEW.equipment_id
    AND status       = 'approved'
    AND earned_at IS NULL
    AND lead_type    = 'pm';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION earn_tech_lead_on_pm_completion() IS
  'Earns an approved tech_lead on first eligible PM completion. Eligible = schedule.billing_type=flat_rate AND interval_months IN (1,2,3,4,6). Payout mirrors the written plan''s PMs-per-year table: 1/2/3 (4+ a year) earn the full flat_rate, 4 (3 a year) earns 75%, 6 (2 a year) earns half, all rounded to the cent; 12 (annual) earns nothing per Caleb 2026-07-31, overriding the plan text that says 25%. Kept in sync with src/lib/tech-leads/pm-bonus.ts (unit-tested). SECURITY DEFINER bypasses tech_leads UPDATE RLS so techs can complete their own tickets without explicit permission on tech_leads. NOTE: trigger is AFTER UPDATE OF status only -- a direct INSERT with status=completed (e.g. seed/migration data) will NOT fire this trigger. Normal app flow always transitions through unassigned/assigned/in_progress, so this gap is unreachable from the UI.';
