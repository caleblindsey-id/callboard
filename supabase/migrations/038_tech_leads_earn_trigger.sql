-- Migration 038: Tech Lead Bonus Earn Trigger
--
-- When a pm_ticket transitions to 'completed' on a piece of equipment that has
-- an approved, unearned tech_lead attached, and the linked pm_schedule is
-- flat_rate billing with interval_months IN (1,2,3) (monthly / bi-monthly /
-- quarterly), mark the lead 'earned' and lock in bonus_amount = schedule.flat_rate.
--
-- SECURITY DEFINER: needed because tech_leads UPDATE is restricted to super_admin
-- + manager, but the trigger must run as any user who completes a PM (technicians
-- included). The function only does the narrow earn UPDATE — no other writes.

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

  -- Eligibility: flat_rate billing, monthly/bi-monthly/quarterly, non-zero rate.
  IF v_interval_months IS NULL
     OR v_interval_months NOT IN (1, 2, 3)
     OR v_billing_type <> 'flat_rate'
     OR v_flat_rate IS NULL
     OR v_flat_rate <= 0 THEN
    RETURN NEW;
  END IF;

  -- Earn the lead if one is waiting. Unique index on tech_leads(equipment_id)
  -- guarantees at most one. earned_at IS NULL guard makes this idempotent.
  UPDATE tech_leads
  SET
    status                = 'earned',
    earned_at             = now(),
    earned_from_ticket_id = NEW.id,
    bonus_amount          = v_flat_rate
  WHERE equipment_id = NEW.equipment_id
    AND status       = 'approved'
    AND earned_at IS NULL
    AND lead_type    = 'pm';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS earn_tech_lead_on_pm_completion_trg ON pm_tickets;

CREATE TRIGGER earn_tech_lead_on_pm_completion_trg
  AFTER UPDATE OF status ON pm_tickets
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION earn_tech_lead_on_pm_completion();

COMMENT ON FUNCTION earn_tech_lead_on_pm_completion() IS
  'Earns an approved tech_lead on first eligible PM completion. Eligible = schedule.billing_type=flat_rate AND interval_months IN (1,2,3). SECURITY DEFINER bypasses tech_leads UPDATE RLS so techs can complete their own tickets without explicit permission on tech_leads.';
