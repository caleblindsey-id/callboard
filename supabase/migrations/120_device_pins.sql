-- Quick-PIN login for technicians. A PIN is NOT a Supabase credential — it is a
-- fast re-entry into a login the tech already established with email+password on
-- this device. One row per (device, tech): a personal phone has a single row, a
-- shared shop device accumulates one row per tech who enrolled there.
--
-- Security model (all server-side):
--   * pin_hash is scrypt(pin + server pepper) — the hash never leaves the server,
--     so a leaked DB row cannot be brute-forced offline without the pepper, and a
--     guessed PIN is useless without the matching device_id.
--   * /api/auth/pin/login runs UNauthenticated under the service-role key (the
--     whole point is the tech has no session yet), verifies the PIN, enforces
--     lockout, then mints a real Supabase session via generateLink + verifyOtp.
--   * failed_attempts / locked_until give server-side brute-force lockout.
-- Mutations all go through the service-role key (SERVER_ONLY admin client), so the
-- RLS policies below only matter for any future direct client reads/deletes.

CREATE TABLE IF NOT EXISTS device_pins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT NOT NULL,            -- random UUID generated client-side, kept in the device's localStorage
  pin_hash        TEXT NOT NULL,            -- scrypt$N$r$p$saltB64$hashB64
  label           TEXT,                     -- e.g. "Jacob's iPhone" — shown in the shared-device picker
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  UNIQUE (device_id, user_id)               -- one PIN per tech per device (enroll upserts on this)
);

-- Login looks a row up by (device_id, user_id); the picker reads a device's rows.
CREATE INDEX IF NOT EXISTS idx_device_pins_device ON device_pins(device_id);
CREATE INDEX IF NOT EXISTS idx_device_pins_user ON device_pins(user_id);

ALTER TABLE device_pins ENABLE ROW LEVEL SECURITY;

-- A tech manages only their own PIN rows. The login path and all mutations run
-- under the service-role key (bypasses RLS), so these scope only direct reads.
DROP POLICY IF EXISTS device_pins_own_select ON device_pins;
CREATE POLICY device_pins_own_select ON device_pins
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS device_pins_own_delete ON device_pins;
CREATE POLICY device_pins_own_delete ON device_pins
  FOR DELETE USING (user_id = auth.uid());
