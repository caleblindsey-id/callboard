-- Machine hours + date code on service_tickets — parity with pm_tickets
-- (migration 030). Techs service equipment on service tickets too, so capture
-- the hour-meter reading and manufacture date code at completion for
-- warranty / service-life tracking. Both optional (service equipment is
-- optional and not every unit has an hour meter), unlike PM where they're
-- required.

ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS machine_hours NUMERIC(10,2);
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS date_code TEXT;
