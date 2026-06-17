-- 125_pm_complete_preserve_po.sql
--
-- Bug: completing a PM ticket could blank a saved customer PO (and the
-- billing-contact fields). fn_complete_pm_ticket overwrote these columns
-- UNCONDITIONALLY from the payload (`po_number = p_payload ->> 'po_number'`),
-- so a completion whose form state was blank/stale wrote SQL NULL and wiped the
-- value. This is the same class of stale-snapshot clobber that bit the auto-save
-- path (feedback #42 PO, #43 notes), which was fixed there with dirty-diffing —
-- the completion RPC was never hardened.
--
-- Fix: make these four fields non-destructive at completion. Only overwrite when
-- a non-empty value is actually provided; otherwise keep the existing DB value.
-- Completion only ever needs to SET/UPDATE a PO, never blank one — clearing a PO
-- still works via the dedicated PoNumberSection PATCH to the generic update
-- route, which is unaffected by this function.
--
-- Only the four highlighted assignments change vs. the prior definition; the rest
-- of the function (auth, locking, idempotency, ACE upsert, month/year slide,
-- schedule anchor) is identical.

CREATE OR REPLACE FUNCTION public.fn_complete_pm_ticket(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF v_caller_role NOT IN ('super_admin', 'manager', 'coordinator', 'technician') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT status, assigned_technician_id, month, year, pm_schedule_id
    INTO v_current_status, v_current_tech, v_current_month, v_current_year, v_current_sched
  FROM pm_tickets
  WHERE id = v_ticket_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'technician' AND v_current_tech IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

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
         -- Non-destructive: only set when a non-empty value is provided, else keep
         -- the existing value (prevents a blank/stale completion from wiping a
         -- saved PO / billing contact).
         po_number               = COALESCE(NULLIF(p_payload ->> 'po_number', ''), po_number),
         billing_contact_name    = COALESCE(NULLIF(p_payload ->> 'billing_contact_name', ''), billing_contact_name),
         billing_contact_email   = COALESCE(NULLIF(p_payload ->> 'billing_contact_email', ''), billing_contact_email),
         billing_contact_phone   = COALESCE(NULLIF(p_payload ->> 'billing_contact_phone', ''), billing_contact_phone),
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
$function$;
