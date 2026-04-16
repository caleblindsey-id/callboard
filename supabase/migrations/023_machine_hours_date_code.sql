-- Add machine hours (equipment hour meter reading) and date code (stamped part/equipment code)
-- to pm_tickets. Both are required at ticket completion.

ALTER TABLE pm_tickets ADD COLUMN machine_hours DECIMAL(10, 2);
ALTER TABLE pm_tickets ADD COLUMN date_code TEXT;
