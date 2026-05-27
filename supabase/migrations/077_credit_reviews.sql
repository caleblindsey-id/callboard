-- Migration 076: Credit-hold release workflow (AR-in-the-loop per order).
--
-- Problem (feedback #9): when a PM is generated for a credit-hold customer the
-- monthly modal silently SKIPS it — the work is lost and never recovered when
-- the hold clears. More broadly there was no way for AR to review work done for
-- a customer who is over their credit limit.
--
-- Design: when a PM or service ticket is created/generated for a customer whose
-- customers.credit_hold = TRUE, we record a row here in 'pending' state and
-- email AR a tokenized link to Release or Block that order (no login — mirrors
-- the customer estimate-approval flow, service_tickets.approval_token). A ticket
-- is "credit-gated" (work cannot advance/complete) while its review is
-- 'pending' or 'blocked'. AR Release -> work proceeds. AR Block -> work locked
-- until a manager enters the shared release passcode (settings, scrypt-hashed).
--
-- Why per-order and not the customer flag: customers.credit_hold is DERIVED and
-- blanket-overwritten every night by scripts/sync/synergy-sync.py from Synergy
-- AR data. If the app cleared it, tonight's sync would flip it back. So the
-- decision lives on the ORDER; the customer flag is only the read-only trigger.

CREATE TABLE IF NOT EXISTS credit_reviews (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type              TEXT NOT NULL CHECK (ticket_type IN ('pm','service')),
  pm_ticket_id             UUID REFERENCES pm_tickets(id) ON DELETE CASCADE,
  service_ticket_id        UUID REFERENCES service_tickets(id) ON DELETE CASCADE,
  customer_id              INT NOT NULL REFERENCES customers(id),
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','released','blocked')),

  -- Tokenized AR action link. Nullified once consumed (release/block) so the
  -- /cr/<token> link can't be replayed.
  action_token             TEXT UNIQUE,
  action_token_expires_at  TIMESTAMPTZ,

  decided_by_name          TEXT,         -- AR's typed name on the /cr page
  decided_at               TIMESTAMPTZ,
  block_reason             TEXT,

  email_message_id         TEXT,         -- Mandrill id of the AR notification
  emailed_at               TIMESTAMPTZ,

  unblocked_by_id          UUID REFERENCES users(id),
  unblocked_at             TIMESTAMPTZ,
  auto_released_at         TIMESTAMPTZ,  -- reserved for optional hold-cleared cron

  updated_by_id            UUID REFERENCES users(id),  -- read by audit_capture()

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one ticket reference, and it must match ticket_type.
  CONSTRAINT credit_reviews_one_ticket CHECK (
    (pm_ticket_id IS NOT NULL)::int + (service_ticket_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT credit_reviews_type_matches_ref CHECK (
    (ticket_type = 'pm'      AND pm_ticket_id IS NOT NULL) OR
    (ticket_type = 'service' AND service_ticket_id IS NOT NULL)
  )
);

COMMENT ON TABLE credit_reviews IS
  'One row per order (PM or service ticket) created for a credit-hold customer. '
  'AR releases/blocks via an emailed tokenized /cr link; managers unblock with '
  'the shared passcode. customers.credit_hold is never mutated here (sync owns it).';

-- One review per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS credit_reviews_pm_ticket_uidx
  ON credit_reviews (pm_ticket_id) WHERE pm_ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_reviews_service_ticket_uidx
  ON credit_reviews (service_ticket_id) WHERE service_ticket_id IS NOT NULL;

-- Hot path: the gate ("is this ticket credit-gated?") only cares about open rows.
CREATE INDEX IF NOT EXISTS credit_reviews_open_idx
  ON credit_reviews (status) WHERE status IN ('pending','blocked');

-- updated_at maintenance for SQL/cron paths (app writes also set it explicitly).
CREATE OR REPLACE FUNCTION set_updated_at_credit_reviews()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS credit_reviews_set_updated_at ON credit_reviews;
CREATE TRIGGER credit_reviews_set_updated_at
  BEFORE UPDATE ON credit_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_credit_reviews();

-- RLS: managers/coordinators read; all writes go through the service-role admin
-- client (bypasses RLS) — inserts at generation/creation, AR consume on /cr,
-- and manager unblock. The technician-facing gate reads via the admin client,
-- so technicians intentionally have no SELECT policy here.
ALTER TABLE credit_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_reviews_manager_select ON credit_reviews;
CREATE POLICY credit_reviews_manager_select
  ON credit_reviews FOR SELECT
  TO authenticated
  USING (get_user_role() IN ('super_admin','manager','coordinator'));

-- Audit: 7th table on the generic trigger (058/059). Release/block/unblock land
-- in audit_events. AR token consume runs with auth.uid() NULL and no
-- updated_by_id -> actor_type='system'/'unattributed' (the domain truth lives in
-- decided_by_name), exactly like /api/approve. Manager unblock sets
-- updated_by_id so it attributes to the manager.
DROP TRIGGER IF EXISTS zz_audit_credit_reviews_trg ON credit_reviews;
CREATE TRIGGER zz_audit_credit_reviews_trg
  AFTER INSERT OR UPDATE OR DELETE ON credit_reviews
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

-- Settings: AR recipient(s) (comma-separated list TO'd on the email) and the
-- scrypt hash of the shared release passcode (never returned by the settings
-- GET — written only via the dedicated credit-passcode endpoint).
INSERT INTO settings (key, value) VALUES
  ('ar_email', ''),
  ('credit_hold_release_passcode_hash', '')
ON CONFLICT (key) DO NOTHING;
