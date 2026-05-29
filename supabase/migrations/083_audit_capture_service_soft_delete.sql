-- Migration 083: Extend audit_capture() soft-delete detection to service_tickets.
--
-- Migration 082 gave service_tickets the same deleted_at/deleted_by_id columns
-- pm_tickets has. audit_capture() classified a NULL -> non-NULL deleted_at
-- UPDATE as action='delete' (and pulled the actor from deleted_by_id), but only
-- for pm_tickets. Now that service soft-delete is an UPDATE too, broaden the
-- gate so service deletes show as 'delete' in the audit log instead of a
-- generic 'update' — parity with PM.
--
-- The deleted_at column refs stay inside the nested IF (planned only when the
-- outer TG_TABLE_NAME test passes), so audited tables WITHOUT the column
-- (equipment, customers, users, pm_schedules) are never planned against it —
-- see migration 060 for the plan-time gotcha this preserves. Both pm_tickets
-- and service_tickets now have the column, so naming both is safe.

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
  v_denylist      TEXT[] := ARRAY[
                              'updated_at',
                              'updated_by_id',
                              'customer_signature'
                            ];
  v_entity_id     TEXT;
  v_row_jsonb     JSONB;
BEGIN
  IF v_set_actor IS NOT NULL AND v_set_actor <> '' THEN
    BEGIN
      v_actor := v_set_actor::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor := NULL;
    END;
  ELSE
    v_actor := auth.uid();
  END IF;

  IF TG_TABLE_NAME = 'equipment' THEN
    v_denylist := v_denylist || ARRAY['ship_to_location_id'];
  END IF;

  -- Soft-delete detection. deleted_at exists on pm_tickets AND service_tickets
  -- (migrations 043 + 082); the column access stays isolated inside a nested IF
  -- so tables without the column are never planned against it (migration 060).
  IF TG_TABLE_NAME IN ('pm_tickets', 'service_tickets') AND TG_OP = 'UPDATE' THEN
    IF (OLD).deleted_at IS NULL AND (NEW).deleted_at IS NOT NULL THEN
      v_action := 'delete';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_row_jsonb := to_jsonb(OLD);
  ELSE
    v_row_jsonb := to_jsonb(NEW);
  END IF;

  v_entity_id := v_row_jsonb ->> 'id';

  IF v_actor IS NULL THEN
    BEGIN
      v_actor := NULLIF(v_row_jsonb ->> 'updated_by_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_actor := NULL;
    END;
  END IF;
  IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
    BEGIN
      v_actor := NULLIF(v_row_jsonb ->> 'created_by_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_actor := NULL;
    END;
  END IF;
  IF v_actor IS NULL AND v_action = 'delete' AND TG_TABLE_NAME IN ('pm_tickets', 'service_tickets') THEN
    BEGIN
      v_actor := NULLIF(v_row_jsonb ->> 'deleted_by_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_actor := NULL;
    END;
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

  IF TG_OP = 'INSERT' THEN
    v_changes := (to_jsonb(NEW)) - v_denylist;
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := (to_jsonb(OLD)) - v_denylist;
  ELSE
    SELECT coalesce(
             jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value)),
             '{}'::jsonb
           )
      INTO v_changes
    FROM jsonb_each(to_jsonb(OLD)) o
    JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
    WHERE o.value IS DISTINCT FROM n.value
      AND key <> ALL(v_denylist);

    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
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
