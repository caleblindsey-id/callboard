-- Web Push subscriptions (Round 2 of tech assignment notifications). One row per
-- browser/device a user has opted into push on. The endpoint is the unique key
-- (a user can subscribe from several devices). The server send path reads these
-- under the service-role key (sendPushToUser); the subscribe/unsubscribe API
-- runs as the user's own session, so RLS scopes writes/reads to their own rows.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user manages only their own subscriptions. The service-role send path
-- bypasses RLS, so no separate read policy is needed for delivery.
DROP POLICY IF EXISTS push_subscriptions_own_select ON push_subscriptions;
CREATE POLICY push_subscriptions_own_select ON push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_insert ON push_subscriptions;
CREATE POLICY push_subscriptions_own_insert ON push_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_update ON push_subscriptions;
CREATE POLICY push_subscriptions_own_update ON push_subscriptions
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_own_delete ON push_subscriptions
  FOR DELETE USING (user_id = auth.uid());
