-- TL-18 (QC Phase 2 R1): enforce server-side VALID_FREQUENCIES at the DB layer.
--
-- Mirrors the constant in src/app/api/tech-leads/route.ts:
--   const VALID_FREQUENCIES: TechLeadFrequency[] = [
--     'monthly', 'bi-monthly', 'quarterly', 'semi-annual', 'annual',
--   ]
--
-- The column lives on tech_leads.proposed_pm_frequency (see migration 037).
-- The PLAN.md note referencing "pm_schedules.proposed_pm_frequency" was a
-- typo; pm_schedules has no such column.
--
-- NULL stays allowed — leads where the tech didn't propose a frequency are
-- valid (the manager picks the interval later when creating equipment from
-- the lead).
ALTER TABLE tech_leads
  ADD CONSTRAINT tech_leads_proposed_pm_frequency_check
  CHECK (
    proposed_pm_frequency IS NULL
    OR proposed_pm_frequency IN ('monthly', 'bi-monthly', 'quarterly', 'semi-annual', 'annual')
  );
