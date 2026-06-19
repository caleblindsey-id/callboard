-- 130_tech_leads_first_pm.sql
-- Techs often perform the first PM on site at the moment they sign the customer
-- up. This lets the tech capture that first PM's completion at submission time;
-- when the manager later creates the PM schedule from the approved lead, the
-- first PM ticket is created already completed + billable (and the tech earns
-- their lead bonus via the existing migration 038 trigger).
--
-- first_pm_completion holds the captured completion payload:
--   { completed_date, hours_worked, machine_hours, date_code, completion_notes,
--     parts_used (PartUsed[]), customer_signature, customer_signature_name }

ALTER TABLE tech_leads
  ADD COLUMN IF NOT EXISTS first_pm_performed boolean NOT NULL DEFAULT false;

ALTER TABLE tech_leads
  ADD COLUMN IF NOT EXISTS first_pm_completion jsonb;
