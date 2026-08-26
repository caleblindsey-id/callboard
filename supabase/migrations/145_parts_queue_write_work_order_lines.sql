-- 145: let fn_update_parts_queue also write the work-order line arrays.
--
-- Why: a requested part and a billed part live in two unrelated JSONB arrays
-- (parts_requested vs parts_used / additional_parts_used), and only the latter
-- is read by billing, the work-order PDF, and the billing export. Parts were
-- being requested, PO'd, received and collected while never landing on the work
-- order, so the branch ate the cost. The parts-queue route now auto-adds a part
-- to the work order the moment it is fulfilled (received, or pulled from stock).
--
-- Why it has to go THROUGH this function rather than a follow-up .update():
-- this UPDATE's `updated_at = p_expected_updated_at` predicate IS the optimistic
-- lock. A second, separate write of parts_used would sit outside that lock and
-- race the technician's completion-form autosave, which PUTs the whole array —
-- one of the two writes would silently lose its line. Folding the columns into
-- the same statement keeps part status and work-order line atomic.
--
-- (Contrast parts_ready_notified_at, which is stamped by a direct .update()
-- after this call. That one is a notification dedup flag: losing a race there
-- costs a duplicate email, not a billable line.)
--
-- Additive and back-compatible: every column uses the same
-- COALESCE(payload -> 'key', column) shape the function already uses for
-- parts_requested, so a payload that omits the new keys behaves exactly as
-- before. additional_parts_used is PM-only (service tickets have no such
-- column), mirroring the existing parts_received asymmetry in the other
-- direction.

CREATE OR REPLACE FUNCTION public.fn_update_parts_queue(
  p_source              text,
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz,
  p_update_payload      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_id   uuid := auth.uid();
  v_updated     jsonb;
BEGIN
  v_caller_role := get_user_role();
  IF v_caller_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '28000';
  END IF;
  IF v_caller_role NOT IN ('super_admin', 'manager', 'coordinator') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_source = 'pm' THEN
    UPDATE pm_tickets
       SET parts_requested       = COALESCE(p_update_payload -> 'parts_requested', parts_requested),
           parts_used            = COALESCE(p_update_payload -> 'parts_used', parts_used),
           additional_parts_used = COALESCE(p_update_payload -> 'additional_parts_used', additional_parts_used),
           synergy_order_number  = CASE
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
           parts_used           = COALESCE(p_update_payload -> 'parts_used', parts_used),
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

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'OPTIMISTIC_LOCK' USING ERRCODE = '40001';
  END IF;

  RETURN v_updated;
END;
$function$;
