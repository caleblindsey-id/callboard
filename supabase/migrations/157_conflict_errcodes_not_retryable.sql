-- 157: stop dressing business-logic conflicts as serialization failures.
--
-- 40001 is `serialization_failure` — the class a client is SUPPOSED to retry
-- automatically, and the Supabase stack does exactly that. A refusal raised
-- with it never reaches the caller: the request is retried until the gateway
-- gives up, so a clean 409 turns into a ~45s 504 with no error message.
--
-- Measured against callboard-dev before this migration, same function, same
-- session, back to back:
--
--     INVALID_SOURCE (22023)      284ms   HTTP 400, error body intact
--     OPTIMISTIC_LOCK (40001)   70,015ms  aborted, still spinning
--
-- Which means the careful 409 mapping in /api/parts-queue/update has never once
-- fired in production, and the single-retry-on-409 in PartsQueueClient that sits
-- behind it is unreachable code. Every concurrent-edit conflict in the Parts
-- Queue has been surfacing to the office as a minute-long hang.
--
-- Both functions below raise P0001 (raise_exception, the plpgsql default) for
-- their conflict branch instead. Every other raise in both functions already
-- uses a terminal code (28000, 42501, 22023) and returns immediately; those are
-- reproduced verbatim and unchanged.
--
-- The 40xxx class stays reserved for genuine transaction-level failures we
-- actually want retried. Precedent already in this repo: confirm_match_candidate
-- and lock_paid_lead_fields (047) raise P0001, as do the payout RPCs (155/156),
-- whose header comments record the same finding from the other direction.
--
-- ROLLOUT ORDER IS SAFE EITHER WAY. The routes that call these functions were
-- changed in the same PR to treat BOTH the raised name and the legacy 40001 as
-- the conflict, so this migration and the deploy do not have to land together.
--
-- Two CREATE OR REPLACEs, no signature change, no data touched. Reverting is
-- re-running 149 and 080.

-- 1) fn_update_parts_queue — OPTIMISTIC_LOCK. Body reproduced verbatim from
--    migration 149 (which added shipping_charge); ONLY the ERRCODE changes.
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
           END,
           shipping_charge       = CASE
             WHEN p_update_payload ? 'shipping_charge'
               THEN NULLIF(p_update_payload ->> 'shipping_charge', '')::numeric
             ELSE shipping_charge
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
           END,
           shipping_charge      = CASE
             WHEN p_update_payload ? 'shipping_charge'
               THEN NULLIF(p_update_payload ->> 'shipping_charge', '')::numeric
             ELSE shipping_charge
           END
     WHERE id            = p_ticket_id
       AND updated_at    = p_expected_updated_at
     RETURNING to_jsonb(service_tickets.*) INTO v_updated;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE' USING ERRCODE = '22023';
  END IF;

  IF v_updated IS NULL THEN
    -- Was 40001. See the header: that code is retried by the stack and the
    -- caller gets a 504 instead of this refusal.
    RAISE EXCEPTION 'OPTIMISTIC_LOCK' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_updated;
END;
$function$;

COMMENT ON FUNCTION public.fn_update_parts_queue(text, uuid, timestamptz, jsonb) IS
  'Parts Queue write behind an optimistic lock on updated_at. Raises '
  'OPTIMISTIC_LOCK (P0001) when the row was modified since the caller read it. '
  'NOT 40001 — that is serialization_failure, which the Supabase stack retries '
  'until the gateway times out (migration 157).';

-- 2) fn_approve_tech_lead_email — STATUS_CONFLICT. Body reproduced verbatim from
--    migration 080 (the emailed_cc_ids jsonb fix); ONLY the ERRCODE changes.
--    Never reported as a hang, because approving an already-approved lead is
--    rare — it was the same bug waiting for someone to hit it.
CREATE OR REPLACE FUNCTION public.fn_approve_tech_lead_email(
  p_lead_id     uuid,
  p_approver_id uuid,
  p_rep_id      uuid,
  p_cc_ids      uuid[],
  p_message_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
         emailed_cc_ids        = to_jsonb(p_cc_ids)
   WHERE id = p_lead_id
     AND status = 'pending'
     AND emailed_to_rep_at IS NULL
   RETURNING to_jsonb(tech_leads.*) INTO v_updated;

  IF v_updated IS NULL THEN
    -- Was 40001, same latent hang as above.
    RAISE EXCEPTION 'STATUS_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_updated;
END;
$function$;

COMMENT ON FUNCTION public.fn_approve_tech_lead_email(uuid, uuid, uuid, uuid[], text) IS
  'Approve a tech lead and stamp the rep email atomically, with emailed_cc_ids '
  'written as to_jsonb(p_cc_ids). Raises STATUS_CONFLICT (P0001) when the lead '
  'was already approved by someone else. NOT 40001 — see migration 157.';

NOTIFY pgrst, 'reload schema';
