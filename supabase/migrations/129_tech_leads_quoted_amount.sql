-- 129_tech_leads_quoted_amount.sql
-- Adds a free-text "quoted amount" captured by the tech on a PM lead. It is
-- intentionally TEXT (not numeric): techs quote in whatever shape fits the deal
-- ("$150 / visit", "150 ea", "TBD"). The manager's Create Equipment flow
-- prefills the Flat Rate field from it when it parses as a clean number, but the
-- raw quote is always preserved for reference. NULL on equipment_sale leads and
-- on legacy PM rows.

ALTER TABLE tech_leads ADD COLUMN IF NOT EXISTS quoted_amount text;
