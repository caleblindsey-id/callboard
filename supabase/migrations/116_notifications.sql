-- In-app notifications (third channel of tech assignment notifications, after
-- email + Web Push). A durable per-user feed surfaced by the notification bell,
-- so bench / "inside" techs who don't monitor email still see a ticket the
-- moment they're in the app. One row per recipient per event; read_at NULL means
-- unread. Rows are written server-side under the service-role key (the assignment
-- caller is the manager/creator, not the recipient), so there is no INSERT policy
-- — RLS only scopes the recipient's own reads + read-state updates.

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  entity_type TEXT,
  entity_id   TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feed query: a user's notifications newest-first.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Unread-count query: only the unread rows per user.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- A user reads only their own notifications. The service-role writer bypasses
-- RLS, so no INSERT policy is needed (and none is granted to clients).
DROP POLICY IF EXISTS notifications_own_select ON notifications;
CREATE POLICY notifications_own_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- A user marks only their own notifications read.
DROP POLICY IF EXISTS notifications_own_update ON notifications;
CREATE POLICY notifications_own_update ON notifications
  FOR UPDATE USING (user_id = auth.uid());
