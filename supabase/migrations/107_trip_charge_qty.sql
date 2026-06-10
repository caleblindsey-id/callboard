-- Trip charge becomes quantity × rate (mirrors labor: hours × labor_rate).
-- The per-trip RATE lives in settings 'trip_charge_amount' (migration 105);
-- this adds the per-ticket QUANTITY (number of trips). Billed trip charge =
-- trip_charge_qty × rate. NULL qty = ticket-type default (field=1, bench=0).
-- The old flat-dollar trip_charge column (105) is left in place but no longer
-- read by billing.
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS trip_charge_qty numeric CHECK (trip_charge_qty >= 0);
ALTER TABLE pm_tickets      ADD COLUMN IF NOT EXISTS trip_charge_qty numeric CHECK (trip_charge_qty >= 0);
