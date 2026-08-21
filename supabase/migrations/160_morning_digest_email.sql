-- Recipient list for the weekday morning digest (/api/cron/morning-digest),
-- ported from the Compass Python script's CALLBOARD_DIGEST_TO and
-- CALLBOARD_DIGEST_CC env vars. First address is To, the rest are CC, matching
-- the parseEmailList convention already used by warranty_reminder_email.
--
-- Seeds EMPTY on purpose, mirroring trip_charge_amount seeding at '0':
-- applying this migration must never start mailing anyone. The Python digest
-- is still live to Ken, Tim and Tamara at the time this lands, so a seeded
-- list would double-send every weekday morning until cutover.
--
-- The cron route treats an empty list as 'morning_digest_email_unset', logs it
-- and skips the send, so the feature is inert until the list is entered in
-- Settings. That entry IS the cutover step, and it happens only after the
-- dry-run parity table is agreed and the Compass scheduled task is turned off.
--
-- The list to enter at cutover:
--   ken.crummie@imperialdade.com;clindsey@imperialdade.com;tadams@imperialdade.com;tridlehoover@imperialdade.com
INSERT INTO settings (key, value) VALUES ('morning_digest_email', '')
  ON CONFLICT (key) DO NOTHING;
