-- Migration 080: fix fn_approve_tech_lead_email cc write.
--
-- Bug: migration 074 defined the function with parameter `p_cc_ids uuid[]` and
-- assigned it directly into `tech_leads.emailed_cc_ids`, which is a JSONB column
-- (migration 066). Postgres has no implicit/assignment cast from uuid[] to jsonb,
-- so the UPDATE raised a datatype-mismatch error (SQLSTATE 42804) on EVERY call —
-- value-independent. plpgsql only type-checks embedded SQL at first execution, so
-- 074 applied cleanly and the approve-and-email flow failed at the durable write
-- (after the rep email was already sent) since PR #22.
--
-- Fix: wrap the array in to_jsonb() so it serializes to a JSON array of id
-- strings — exactly what the column comment describes ("array of sales_reps.id
-- strings") and what the pre-#22 PostgREST write stored.
--
-- Signature is byte-identical to 074 so CREATE OR REPLACE replaces in place
-- (a mismatch would create a second overload and break PostgREST resolution).

CREATE OR REPLACE FUNCTION fn_approve_tech_lead_email(
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
         emailed_cc_ids        = to_jsonb(p_cc_ids)   -- 080: was `p_cc_ids` (uuid[] -> jsonb mismatch)
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
  'Round F (074), cc-cast fixed (080): atomic status-guarded flip from pending -> '
  'approved for an equipment-sale lead after the rep email has been sent. '
  'emailed_cc_ids written as to_jsonb(p_cc_ids). Raises STATUS_CONFLICT (40001) '
  'when the lead was already approved by someone else.';
