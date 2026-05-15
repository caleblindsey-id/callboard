-- Migration 074: Transactional Postgres functions for three multi-write routes
-- (Round F — Transactional Safety).
--
-- Today three API routes do N back-to-back single-statement writes against
-- Supabase. If write #2 fails after write #1 succeeds, the row is left in a
-- half-completed state and the client gets a 500 it can't safely retry from.
--
-- This migration introduces three SECURITY DEFINER plpgsql functions that
-- execute each route's writes inside a single Postgres transaction. The routes
-- (src/app/api/...) keep all of their validation, sanitization, side-effect
-- (Mandrill / storage signed URLs) and business-logic math in TypeScript and
-- pass already-validated payloads to the RPC. The RPC is just the durable-
-- write tier — fail-atomic, role-guarded, and status-guarded.
--
-- Role gates inside each function:
--   - We rely on get_user_role() (added in migration 044, reads auth.uid())
--     so the role check still works when invoked via the user-context Supabase
--     client. Functions still also re-validate caller identity / state.
--
-- The functions deliberately do NOT touch external services (email, storage).
-- The route still runs Mandrill + sign-URL BEFORE calling the RPC so a failed
-- email cancels the approval, and a failed RPC doesn't leak emails.
--
-- See plpgsql Trigger Column Gate memory: not relevant here (no triggers).

-- =============================================================================
-- 1. fn_complete_pm_ticket
-- =============================================================================
-- Wraps the writes done by POST /api/tickets/[id]/complete:
--   a. Optional ACE labor upsert (insert or update an existing pending row)
--   b. pm_tickets UPDATE -> status='completed' + all completion fields
--   c. Optional month/year slide when completed_date falls in a different month
--   d. Optional pm_schedules.anchor_month update for that slide
--
-- Idempotency: if the ticket is already completed (status='completed' or
-- 'billed'), the function raises 'ALREADY_COMPLETED' so the route can return
-- 409. Note: the route's idempotency guarantee (no-op on duplicate complete)
-- still flows through the route's own status pre-check; this guard is the
-- belt-and-suspenders inside the txn.

DROP FUNCTION IF EXISTS fn_complete_pm_ticket(jsonb);

CREATE FUNCTION fn_complete_pm_ticket(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role      text;
  v_caller_id        uuid := auth.uid();
  v_ticket_id        uuid := (p_payload ->> 'ticket_id')::uuid;
  v_current_status   text;
  v_current_tech     uuid;
  v_current_month    int;
  v_current_year     int;
  v_current_sched    uuid;
  v_completed_month  int := (p_payload ->> 'completed_month')::int;
  v_completed_year   int := (p_payload ->> 'completed_year')::int;
  v_ace              jsonb := p_payload -> 'ace_labor';
  v_existing_ace_id  uuid;
  v_existing_ace_st  text;
  v_updated_ticket   jsonb;
  v_did_slide        boolean := false;
  v_slide_conflict   boolean := false;
BEGIN
  -- Role / auth gate
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF v_caller_role NOT IN ('super_admin', 'manager', 'coordinator', 'technician') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Load + lock the ticket row for the duration of the txn so a concurrent
  -- complete can't race us. Also re-validate state inside the lock.
  SELECT status, assigned_technician_id, month, year, pm_schedule_id
    INTO v_current_status, v_current_tech, v_current_month, v_current_year, v_current_sched
  FROM pm_tickets
  WHERE id = v_ticket_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Techs can only complete their own ticket. Managers / coordinators can
  -- complete on a tech's behalf.
  IF v_caller_role = 'technician' AND v_current_tech IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Idempotency: a duplicate complete on an already-completed ticket is a
  -- no-op — return the current row unchanged so retries / double-clicks
  -- don't 409 the user. 'billed' is treated as a hard 409 since the row
  -- has been exported and post-hoc edits silently corrupt records.
  IF v_current_status = 'completed' THEN
    SELECT to_jsonb(pm_tickets.*) INTO v_updated_ticket
      FROM pm_tickets
      WHERE id = v_ticket_id;
    RETURN jsonb_build_object(
      'ticket',         v_updated_ticket,
      'did_slide',      false,
      'slide_conflict', false,
      'no_op',          true
    );
  END IF;
  IF v_current_status = 'billed' THEN
    RAISE EXCEPTION 'ALREADY_BILLED' USING ERRCODE = '40000';
  END IF;

  -- ACE labor upsert (when present). Done BEFORE the ticket transitions to
  -- completed so a failure here aborts the whole txn — the ticket stays in
  -- its pre-route state. The partial unique index on pm_ticket_id keeps the
  -- update side of upsert in-place.
  IF v_ace IS NOT NULL AND v_ace <> 'null'::jsonb THEN
    SELECT id, status
      INTO v_existing_ace_id, v_existing_ace_st
    FROM ace_labor_entries
    WHERE pm_ticket_id = v_ticket_id;

    IF v_existing_ace_id IS NOT NULL AND v_existing_ace_st IN ('approved', 'paid') THEN
      RAISE EXCEPTION 'ACE_LOCKED' USING ERRCODE = '40000';
    END IF;

    IF v_existing_ace_id IS NOT NULL THEN
      UPDATE ace_labor_entries
         SET hours                  = (v_ace ->> 'hours')::numeric,
             reason                 = v_ace ->> 'reason',
             labor_rate_type        = v_ace ->> 'labor_rate_type',
             status                 = 'pending',
             rejected_reason        = NULL,
             approved_by_id         = NULL,
             approved_at            = NULL,
             rate_value_at_approval = NULL,
             submitted_at           = now(),
             updated_by_id          = v_caller_id
       WHERE id = v_existing_ace_id;
    ELSE
      INSERT INTO ace_labor_entries (
        pm_ticket_id, tech_id, hours, labor_rate_type, reason,
        status, created_by_id
      ) VALUES (
        v_ticket_id,
        COALESCE(v_current_tech, v_caller_id),
        (v_ace ->> 'hours')::numeric,
        v_ace ->> 'labor_rate_type',
        v_ace ->> 'reason',
        'pending',
        v_caller_id
      );
    END IF;
  END IF;

  -- Ticket completion update. Status guard is implicit via the FOR UPDATE
  -- lock above; we already confirmed status is not completed/billed.
  UPDATE pm_tickets
     SET status                  = 'completed',
         completed_date          = (p_payload ->> 'completed_date')::date,
         hours_worked            = (p_payload ->> 'hours_worked')::numeric,
         parts_used              = COALESCE(p_payload -> 'parts_used', '[]'::jsonb),
         completion_notes        = p_payload ->> 'completion_notes',
         billing_amount          = (p_payload ->> 'billing_amount')::numeric,
         customer_signature      = p_payload ->> 'customer_signature',
         customer_signature_name = p_payload ->> 'customer_signature_name',
         photos                  = COALESCE(p_payload -> 'photos', '[]'::jsonb),
         po_number               = p_payload ->> 'po_number',
         billing_contact_name    = p_payload ->> 'billing_contact_name',
         billing_contact_email   = p_payload ->> 'billing_contact_email',
         billing_contact_phone   = p_payload ->> 'billing_contact_phone',
         additional_parts_used   = COALESCE(p_payload -> 'additional_parts_used', '[]'::jsonb),
         additional_hours_worked = (p_payload ->> 'additional_hours_worked')::numeric,
         machine_hours           = (p_payload ->> 'machine_hours')::numeric,
         date_code               = p_payload ->> 'date_code',
         show_pricing            = (p_payload ->> 'show_pricing')::boolean
   WHERE id = v_ticket_id AND deleted_at IS NULL
   RETURNING to_jsonb(pm_tickets.*) INTO v_updated_ticket;

  IF v_updated_ticket IS NULL THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Slide billing period to completion month if work happened in a different
  -- month. A unique violation (sibling ticket already exists for that
  -- schedule+month+year) is non-fatal — we keep the original billing period
  -- and still advance the anchor below.
  IF v_completed_month IS NOT NULL
     AND v_completed_year IS NOT NULL
     AND (v_completed_month <> v_current_month OR v_completed_year <> v_current_year) THEN
    BEGIN
      UPDATE pm_tickets
         SET month = v_completed_month,
             year  = v_completed_year
       WHERE id = v_ticket_id;
      v_did_slide := true;
      v_updated_ticket := jsonb_set(
        jsonb_set(v_updated_ticket, '{month}', to_jsonb(v_completed_month)),
        '{year}', to_jsonb(v_completed_year)
      );
    EXCEPTION
      WHEN unique_violation THEN
        v_slide_conflict := true;
    END;

    IF v_current_sched IS NOT NULL THEN
      UPDATE pm_schedules
         SET anchor_month = v_completed_month
       WHERE id = v_current_sched;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ticket',         v_updated_ticket,
    'did_slide',      v_did_slide,
    'slide_conflict', v_slide_conflict
  );
END;
$$;

COMMENT ON FUNCTION fn_complete_pm_ticket(jsonb) IS
  'Round F (074): atomically complete a PM ticket — optional ACE labor upsert, '
  'pm_tickets completion update, optional month/year slide, anchor update. '
  'All-or-nothing. Caller is auth.uid(); role gated.';

-- =============================================================================
-- 2. fn_update_parts_queue
-- =============================================================================
-- Wraps POST /api/parts-queue/update. The route does a fetch + a single UPDATE
-- guarded by .eq(updated_at, ...) for optimistic locking. The function keeps
-- the same shape — it RAISEs distinct error codes for "row changed by
-- someone else" (409 in route) vs "not found" (404).
--
-- The route still handles all the parts_requested merging, status-machine
-- decisions, and validation in TypeScript. The function just takes the final
-- patch payload as jsonb plus the expected updated_at for the optimistic-lock
-- check.

DROP FUNCTION IF EXISTS fn_update_parts_queue(text, uuid, timestamptz, jsonb);

CREATE FUNCTION fn_update_parts_queue(
  p_source              text,            -- 'pm' or 'service'
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz,
  p_update_payload      jsonb            -- e.g. { parts_requested: [...], parts_received?: bool, synergy_order_number?: ... }
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_id   uuid := auth.uid();
  v_updated     jsonb;
BEGIN
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  -- MANAGER_ROLES = super_admin, manager, coordinator (matches route guard).
  IF v_caller_role NOT IN ('super_admin', 'manager', 'coordinator') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_source = 'pm' THEN
    UPDATE pm_tickets
       SET parts_requested      = COALESCE(p_update_payload -> 'parts_requested', parts_requested),
           synergy_order_number = CASE
             WHEN p_update_payload ? 'synergy_order_number'
               THEN NULLIF(p_update_payload ->> 'synergy_order_number', '')
             ELSE synergy_order_number
           END
     WHERE id            = p_ticket_id
       AND updated_at    = p_expected_updated_at
     RETURNING to_jsonb(pm_tickets.*) INTO v_updated;

  ELSIF p_source = 'service' THEN
    UPDATE service_tickets
       SET parts_requested      = COALESCE(p_update_payload -> 'parts_requested', parts_requested),
           parts_received       = CASE
             WHEN p_update_payload ? 'parts_received'
               THEN (p_update_payload ->> 'parts_received')::boolean
             ELSE parts_received
           END,
           synergy_order_number = CASE
             WHEN p_update_payload ? 'synergy_order_number'
               THEN NULLIF(p_update_payload ->> 'synergy_order_number', '')
             ELSE synergy_order_number
           END
     WHERE id            = p_ticket_id
       AND updated_at    = p_expected_updated_at
     RETURNING to_jsonb(service_tickets.*) INTO v_updated;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE' USING ERRCODE = '22023';
  END IF;

  -- updated_at mismatch (or row gone) => optimistic-lock failure. Distinct
  -- error code so the route can return 409 instead of 500.
  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK' USING ERRCODE = '40001';
  END IF;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION fn_update_parts_queue(text, uuid, timestamptz, jsonb) IS
  'Round F (074): atomic parts-queue write with optimistic locking on '
  'updated_at. Raises OPTIMISTIC_LOCK (40001) when the row was modified '
  'between the route fetch and write.';

-- =============================================================================
-- 3. fn_approve_tech_lead_email
-- =============================================================================
-- Wraps POST /api/tech-leads/[id]/approve-and-email's DB write (status flip
-- from 'pending' -> 'approved' + email-audit columns). The route runs Mandrill
-- BEFORE this RPC so a Mandrill failure cancels approval. The function
-- enforces the status='pending' gate via .eq filter + raises a distinct
-- status-conflict code when the gate misses (concurrent approver).

DROP FUNCTION IF EXISTS fn_approve_tech_lead_email(uuid, uuid, uuid, uuid[], text);

CREATE FUNCTION fn_approve_tech_lead_email(
  p_lead_id        uuid,
  p_approver_id    uuid,
  p_rep_id         uuid,
  p_cc_ids         uuid[],
  p_message_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_id   uuid := auth.uid();
  v_now         timestamptz := now();
  v_updated     jsonb;
BEGIN
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  -- RESET_ROLES = super_admin, manager (matches route guard).
  IF v_caller_role NOT IN ('super_admin', 'manager') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- The route passes its current user id; we sanity-check it matches the
  -- caller so a tampered body can't blame someone else for the approval.
  IF p_approver_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE tech_leads
     SET status                = 'approved',
         approved_by           = p_approver_id,
         approved_at           = v_now,
         emailed_to_rep_id     = p_rep_id,
         emailed_to_rep_at     = v_now,
         email_rep_message_id  = p_message_id,
         emailed_cc_ids        = p_cc_ids
   WHERE id = p_lead_id
     AND status = 'pending'
     AND emailed_to_rep_at IS NULL
   RETURNING to_jsonb(tech_leads.*) INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'STATUS_CONFLICT' USING ERRCODE = '40001';
  END IF;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION fn_approve_tech_lead_email(uuid, uuid, uuid, uuid[], text) IS
  'Round F (074): atomic status-guarded flip from pending -> approved for an '
  'equipment-sale lead after the rep email has been sent. Raises '
  'STATUS_CONFLICT (40001) when the lead was already approved by someone else.';

-- =============================================================================
-- 4. Grants
-- =============================================================================
-- All three functions run as SECURITY DEFINER and bake their own role checks.
-- Granting EXECUTE to authenticated is safe — the in-function gate is the
-- real authority.
GRANT EXECUTE ON FUNCTION fn_complete_pm_ticket(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION fn_update_parts_queue(text, uuid, timestamptz, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION fn_approve_tech_lead_email(uuid, uuid, uuid, uuid[], text)
  TO authenticated;
