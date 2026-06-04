-- Migration 095: Four-month PM leads earn 75% of the bonus
--
-- Extends migration 094. Partial-bonus intervals are now:
--   1 / 2 / 3 (monthly / bi-monthly / quarterly) -> full flat rate
--   4 (every four months)                        -> 75% of flat rate  (NEW)
--   6 (semi-annual)                              -> 50% of flat rate
--   12 (annual)                                  -> nothing
-- All rounded to the cent. Forward-only: fires on the next PM completion for
-- any approved, unearned lead; already-earned leads are untouched.
--
-- CREATE OR REPLACE updates the function the existing trigger already calls, so
-- the trigger itself does not need to be recreated.

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
  -- 1/2/3 earn full; 4 earns 75%; 6 (semi-annual) earns half; 12 (annual) nothing.
  IF v_interval_months IS NULL
     OR v_interval_months NOT IN (1, 2, 3, 4, 6)
     OR v_billing_type <> 'flat_rate'
     OR v_flat_rate IS NULL
     OR v_flat_rate <= 0 THEN
    RETURN NEW;
  END IF;

  -- Earn the lead if one is waiting. Unique index on tech_leads(equipment_id)
  -- guarantees at most one. earned_at IS NULL guard makes this idempotent.
  -- Partial-bonus intervals (4 -> 75%, 6 -> 50%) are rounded to the cent.
  UPDATE tech_leads
  SET
    status                = 'earned',
    earned_at             = now(),
    earned_from_ticket_id = NEW.id,
    bonus_amount          = ROUND(
                              CASE WHEN v_interval_months IN (1, 2, 3) THEN v_flat_rate
                                   WHEN v_interval_months = 4 THEN v_flat_rate * 0.75  -- four-month: 75%
                                   ELSE v_flat_rate * 0.5                              -- interval 6: half
                              END, 2)
  WHERE equipment_id = NEW.equipment_id
    AND status       = 'approved'
    AND earned_at IS NULL
    AND lead_type    = 'pm';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION earn_tech_lead_on_pm_completion() IS
  'Earns an approved tech_lead on first eligible PM completion. Eligible = schedule.billing_type=flat_rate AND interval_months IN (1,2,3,4,6): 1/2/3 earn the full flat_rate, 4 earns 75%, 6 (semi-annual) earns half, 12 (annual) earns nothing — partials rounded to the cent. SECURITY DEFINER bypasses tech_leads UPDATE RLS so techs can complete their own tickets without explicit permission on tech_leads. NOTE: trigger is AFTER UPDATE OF status only — a direct INSERT with status=completed (e.g. seed/migration data) will NOT fire this trigger. Normal app flow always transitions through unassigned/assigned/in_progress, so this gap is unreachable from the UI.';
