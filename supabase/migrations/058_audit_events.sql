-- Migration 058: Comprehensive audit trail (audit_events + triggers).
--
-- Today there's exactly one history table in the codebase
-- (equipment_location_history, migration 049). For every other entity we have
-- no way to answer "who changed what when" — status transitions on PM and
-- service tickets are invisible, equipment inline edits leave no trace,
-- customer credit-hold flips are not logged, etc. This migration installs a
-- single generic audit table + one trigger function reused across the seven
-- highest-value tables.
--
-- Design notes:
--   1. ONE table, audit_events, indexed for the two read surfaces we ship
--      alongside this migration — a global /admin/audit-log page and a
--      per-record history tab.
--   2. ONE trigger function, audit_capture(), reused per table via
--      TG_TABLE_NAME. Triggers are named zz_audit_<table>_trg so they fire
--      LAST in alphabetical order, after any existing business triggers
--      (e.g. earn_tech_lead_on_pm_completion_trg on pm_tickets).
--   3. User attribution. PostgREST sets auth.uid() per transaction for
--      user-client writes — the trigger reads it directly. Admin-client
--      writes via supabase service_role have auth.uid() = NULL; the trigger
--      falls back to a session GUC app.acting_user_id which a follow-up
--      migration's admin RPCs will set inside their own transactions
--      (SET LOCAL works there because the SET and the write share a txn).
--   4. Deploy-order safety. Until migration 059 + the API route conversions
--      ship, admin-client writes will produce audit rows with
--      actor_type='system' and changed_by=NULL — visible in the log as
--      "unattributed admin write" but not error out. No CHECK constraint
--      pinning actor_type to changed_by NOT NULL for that reason.
--   5. Diff strategy. UPDATE rows store only changed keys, denylisted to
--      skip updated_at (noise) and customer_signature (base64 blob).
--      INSERT/DELETE rows store the full row sans denylist.
--   6. equipment_location_history (migration 049) is left in place.
--      The equipment audit trigger denylists ship_to_location_id so we
--      don't double-record relocations. The relocate RPC keeps writing to
--      equipment_location_history exclusively.
--   7. Soft delete. pm_tickets uses deleted_at instead of DELETE. The
--      trigger detects the NULL->non-NULL transition and emits
--      action='delete' for that case so the timeline reads correctly.

-- ---------------------------------------------------------------------------
-- 1. audit_events table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user','customer','system','sync')),
  changed_by   UUID REFERENCES users(id),
  actor_label  TEXT,
  changes      JSONB NOT NULL,
  context      JSONB
);

COMMENT ON TABLE audit_events IS
  'Append-only change log for the seven core entities (service_tickets, '
  'pm_tickets, equipment, pm_schedules, customers, users, parts_order_queue). '
  'Written exclusively by the audit_capture() trigger function. '
  'Visibility: super_admin only via RLS.';

COMMENT ON COLUMN audit_events.entity_type IS
  'Table name (matches TG_TABLE_NAME). e.g. ''service_tickets'', ''equipment''.';

COMMENT ON COLUMN audit_events.entity_id IS
  'Primary key of the affected row as text. UUID or numeric — both stringify.';

COMMENT ON COLUMN audit_events.actor_type IS
  '''user'' for authenticated app users (changed_by populated). '
  '''customer'' for external estimate approvals via /api/approve/[token] '
  '(changed_by NULL, actor_label set to signature_name). '
  '''system'' for any unattributed admin-client write (deploy-order fallback) '
  'or trigger-cascaded writes. ''sync'' reserved for the Synergy sync job.';

COMMENT ON COLUMN audit_events.changes IS
  'INSERT: full new row sans denylist. UPDATE: {col: {old, new}} for only '
  'columns that changed. DELETE: full old row sans denylist (tombstone).';

COMMENT ON COLUMN audit_events.context IS
  'Optional sidecar metadata: {ip, user_agent, request_path, source}. '
  '''source'' is set by cascading SECURITY DEFINER functions (e.g. when '
  'the tech_lead earn trigger writes to tech_leads, the resulting audit '
  'row carries context.source = ''trigger:earn_lead'').';

-- Indexes drive the two read surfaces:
--   - per-entity History tab: (entity_type, entity_id, occurred_at DESC)
--   - global page: BRIN on occurred_at for date-range scans, plus
--     (changed_by, occurred_at DESC) and (entity_type, occurred_at DESC)
--     for the dropdown filters.
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events (entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_brin_idx
  ON audit_events USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS audit_events_changed_by_idx
  ON audit_events (changed_by, occurred_at DESC)
  WHERE changed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_entity_type_idx
  ON audit_events (entity_type, occurred_at DESC);

-- RLS: SELECT for super_admin only. NO insert/update/delete policy at all —
-- writes happen exclusively via the SECURITY DEFINER trigger function which
-- bypasses RLS. Direct supabase-js writes from any role are blocked.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_super_admin_select ON audit_events;
CREATE POLICY audit_events_super_admin_select
  ON audit_events FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- 2. audit_capture() — generic trigger function reused per table
-- ---------------------------------------------------------------------------
-- Reads actor identity in this order:
--   a. current_setting('app.acting_user_id', true) — set by admin RPCs via
--      SET LOCAL inside their own transactions.
--   b. auth.uid() — present per-transaction for user-client writes.
--   c. NULL — actor_type defaults to 'system' with label 'unattributed'.
--
-- If app.actor_type / app.actor_label / app.audit_source are set in the
-- same transaction (by admin RPCs or cascading triggers) they take
-- precedence over the auto-derived defaults.
CREATE OR REPLACE FUNCTION audit_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set_actor     TEXT  := current_setting('app.acting_user_id', true);
  v_set_type      TEXT  := current_setting('app.actor_type', true);
  v_set_label     TEXT  := current_setting('app.actor_label', true);
  v_set_source    TEXT  := current_setting('app.audit_source', true);
  v_actor         UUID;
  v_actor_type    TEXT;
  v_actor_label   TEXT;
  v_action        TEXT  := lower(TG_OP);
  v_changes       JSONB;
  v_denylist      TEXT[] := ARRAY['updated_at','customer_signature'];
  v_entity_id     TEXT;
BEGIN
  -- Resolve actor identity.
  IF v_set_actor IS NOT NULL AND v_set_actor <> '' THEN
    BEGIN
      v_actor := v_set_actor::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor := NULL;
    END;
  ELSE
    v_actor := auth.uid();
  END IF;

  IF v_set_type IS NOT NULL AND v_set_type <> '' THEN
    v_actor_type := v_set_type;
  ELSIF v_actor IS NOT NULL THEN
    v_actor_type := 'user';
  ELSE
    v_actor_type := 'system';
  END IF;

  IF v_set_label IS NOT NULL AND v_set_label <> '' THEN
    v_actor_label := v_set_label;
  ELSIF v_actor_type = 'system' AND v_actor IS NULL THEN
    v_actor_label := 'unattributed';
  ELSE
    v_actor_label := NULL;
  END IF;

  -- Equipment-specific denylist: ship_to_location_id is already tracked in
  -- equipment_location_history via relocate_equipment_for_pm() (migration
  -- 049). Skip it here to avoid double-recording.
  IF TG_TABLE_NAME = 'equipment' THEN
    v_denylist := v_denylist || ARRAY['ship_to_location_id'];
  END IF;

  -- Soft-delete detection on pm_tickets: NULL -> non-NULL deleted_at is
  -- semantically a delete, not an update.
  IF TG_TABLE_NAME = 'pm_tickets'
     AND TG_OP = 'UPDATE'
     AND (OLD).deleted_at IS NULL
     AND (NEW).deleted_at IS NOT NULL THEN
    v_action := 'delete';
  END IF;

  -- Build the changes payload.
  IF TG_OP = 'INSERT' THEN
    v_changes := (to_jsonb(NEW)) - v_denylist;
    v_entity_id := (to_jsonb(NEW)->>'id');
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := (to_jsonb(OLD)) - v_denylist;
    v_entity_id := (to_jsonb(OLD)->>'id');
  ELSE
    -- UPDATE: diff only the changed keys, skipping the denylist.
    SELECT coalesce(
             jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value)),
             '{}'::jsonb
           )
      INTO v_changes
    FROM jsonb_each(to_jsonb(OLD)) o
    JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
    WHERE o.value IS DISTINCT FROM n.value
      AND key <> ALL(v_denylist);

    -- Pure no-op (only updated_at changed, or only denylisted columns):
    -- swallow the row to avoid noise.
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;

    v_entity_id := (to_jsonb(NEW)->>'id');
  END IF;

  INSERT INTO audit_events (
    entity_type, entity_id, action,
    actor_type, changed_by, actor_label,
    changes, context
  ) VALUES (
    TG_TABLE_NAME, v_entity_id, v_action,
    v_actor_type,
    CASE WHEN v_actor_type = 'user' THEN v_actor ELSE NULL END,
    v_actor_label,
    v_changes,
    CASE WHEN v_set_source IS NULL OR v_set_source = '' THEN NULL
         ELSE jsonb_build_object('source', v_set_source)
    END
  );

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION audit_capture() IS
  'Generic AFTER INSERT/UPDATE/DELETE trigger. Writes one row to '
  'audit_events per meaningful change. Reuses TG_TABLE_NAME to identify '
  'the entity. SECURITY DEFINER bypasses RLS on audit_events.';

REVOKE ALL ON FUNCTION audit_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_capture() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers — one per audited table, named zz_audit_*_trg to fire LAST
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS zz_audit_service_tickets_trg ON service_tickets;
CREATE TRIGGER zz_audit_service_tickets_trg
  AFTER INSERT OR UPDATE OR DELETE ON service_tickets
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_pm_tickets_trg ON pm_tickets;
CREATE TRIGGER zz_audit_pm_tickets_trg
  AFTER INSERT OR UPDATE OR DELETE ON pm_tickets
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_equipment_trg ON equipment;
CREATE TRIGGER zz_audit_equipment_trg
  AFTER INSERT OR UPDATE OR DELETE ON equipment
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_pm_schedules_trg ON pm_schedules;
CREATE TRIGGER zz_audit_pm_schedules_trg
  AFTER INSERT OR UPDATE OR DELETE ON pm_schedules
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_customers_trg ON customers;
CREATE TRIGGER zz_audit_customers_trg
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_users_trg ON users;
CREATE TRIGGER zz_audit_users_trg
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_parts_order_queue_trg ON parts_order_queue;
CREATE TRIGGER zz_audit_parts_order_queue_trg
  AFTER INSERT OR UPDATE OR DELETE ON parts_order_queue
  FOR EACH ROW EXECUTE FUNCTION audit_capture();
