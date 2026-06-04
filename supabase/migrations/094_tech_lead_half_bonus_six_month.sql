-- Migration 094: Six-month PM leads earn HALF the bonus
--
-- Updates the earn trigger from migration 038. Previously only monthly /
-- bi-monthly / quarterly (interval_months IN (1,2,3)) flat-rate PMs earned a
-- bonus equal to the schedule's flat_rate; semi-annual (6) and annual (12)
-- earned nothing.
--
-- New rule: six-month (interval_months = 6) flat-rate PMs now earn HALF the
-- flat rate (rounded to the cent). 1/2/3 still earn the full flat rate. 4-month
-- and annual (12) still earn nothing. Forward-only: fires on the next PM
-- completion for any approved, unearned lead; already-earned leads are untouched.
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
  -- 1/2/3 (monthly/bi-monthly/quarterly) earn full; 6 (semi-annual) earns half;
  -- 4 and 12 earn nothing.
  IF v_interval_months IS NULL
     OR v_interval_months NOT IN (1, 2, 3, 6)
     OR v_billing_type <> 'flat_rate'
     OR v_flat_rate IS NULL
     OR v_flat_rate <= 0 THEN
    RETURN NEW;
  END IF;

  -- Earn the lead if one is waiting. Unique index on tech_leads(equipment_id)
  -- guarantees at most one. earned_at IS NULL guard makes this idempotent.
  -- Six-month schedules earn half the flat rate, rounded to the cent.
  UPDATE tech_leads
  SET
    status                = 'earned',
    earned_at             = now(),
    earned_from_ticket_id = NEW.id,
    bonus_amount          = ROUND(
                              CASE WHEN v_interval_months IN (1, 2, 3) THEN v_flat_rate
                                   ELSE v_flat_rate * 0.5  -- interval 6: half
                              END, 2)
  WHERE equipment_id = NEW.equipment_id
    AND status       = 'approved'
    AND earned_at IS NULL
    AND lead_type    = 'pm';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION earn_tech_lead_on_pm_completion() IS
  'Earns an approved tech_lead on first eligible PM completion. Eligible = schedule.billing_type=flat_rate AND interval_months IN (1,2,3,6): 1/2/3 earn the full flat_rate, 6 (semi-annual) earns half (rounded to the cent), 4 and 12 earn nothing. SECURITY DEFINER bypasses tech_leads UPDATE RLS so techs can complete their own tickets without explicit permission on tech_leads. NOTE: trigger is AFTER UPDATE OF status only — a direct INSERT with status=completed (e.g. seed/migration data) will NOT fire this trigger. Normal app flow always transitions through unassigned/assigned/in_progress, so this gap is unreachable from the UI.';
