-- Trip charge: a flat per-ticket fee for sending a tech out, mirroring the
-- labor-rate settings pattern (global default) + the diagnostic_charge flat fee
-- (per-ticket, editable). Settings value seeds at '0' so applying this migration
-- never silently adds a charge to live tickets — the feature turns on when a
-- dollar amount is entered in Settings.
INSERT INTO settings (key, value) VALUES ('trip_charge_amount', '0')
  ON CONFLICT (key) DO NOTHING;

-- Per-ticket editable trip charge. NULL = use the ticket-type default
-- (field/PM = settings value; service 'inside'/bench drop-off = 0).
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS trip_charge numeric CHECK (trip_charge >= 0);
ALTER TABLE pm_tickets      ADD COLUMN IF NOT EXISTS trip_charge numeric CHECK (trip_charge >= 0);
