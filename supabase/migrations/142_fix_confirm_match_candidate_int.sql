-- Migration 142: Fix confirm_match_candidate type mismatch (feedback #77).
--
-- confirm_match_candidate (migration 047) declared its local
-- v_synergy_order_number as TEXT, but both the source column
-- (equipment_sale_lead_candidates.synergy_order_number) and the target
-- (tech_leads.sale_synergy_order_number) are INTEGER. Postgres tolerates the
-- integer -> text coercion on the `RETURNING ... INTO`, but refuses the
-- implicit text -> integer assignment on the final `UPDATE tech_leads SET
-- sale_synergy_order_number = v_synergy_order_number`, raising
--   SQLSTATE 42804: column "sale_synergy_order_number" is of type integer
--                   but expression is of type text
-- That error is not P0001, so the confirm / manual-match routes fall through to
-- their generic 500 ("Failed to confirm the match."). Net effect: EVERY
-- equipment-sale match confirmation has failed since 047 shipped — both the
-- manual "Match & earn" button and the nightly-scan "Review & confirm" path.
-- No equipment-sale lead had ever earned as a result.
--
-- Fix: declare v_synergy_order_number as INTEGER so it matches the columns on
-- both ends. Body is otherwise identical to migration 047. The returned JSONB
-- now carries synergy_order_number as a JSON number instead of a string; no
-- caller reads that field (both routes only branch on success/error), so this
-- is behaviour-preserving for the API.

CREATE OR REPLACE FUNCTION confirm_match_candidate(
  p_lead_id UUID,
  p_candidate_id UUID,
  p_tier TEXT,
  p_bonus_amount NUMERIC,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_synergy_order_number INTEGER;
  v_now TIMESTAMPTZ := now();
  v_rows INT;
BEGIN
  -- 1. Confirm the candidate. Compare-and-swap on status='pending'.
  UPDATE equipment_sale_lead_candidates
  SET status = 'confirmed', reviewed_by = p_user_id, reviewed_at = v_now
  WHERE id = p_candidate_id
    AND tech_lead_id = p_lead_id
    AND status = 'pending'
  RETURNING synergy_order_number INTO v_synergy_order_number;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Candidate not pending or does not belong to this lead'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Dismiss any sibling pending candidates on this lead.
  UPDATE equipment_sale_lead_candidates
  SET status = 'dismissed', reviewed_by = p_user_id, reviewed_at = v_now
  WHERE tech_lead_id = p_lead_id
    AND status = 'pending'
    AND id <> p_candidate_id;

  -- 3. Earn the lead — but only if it's still in an earnable state.
  --    This is the second compare-and-swap: races where another manager
  --    already earned this lead via a different candidate fail here.
  UPDATE tech_leads
  SET status = 'earned',
      sale_equipment_tier = p_tier,
      sale_synergy_order_number = v_synergy_order_number,
      bonus_amount = p_bonus_amount,
      earned_at = v_now
  WHERE id = p_lead_id
    AND lead_type = 'equipment_sale'
    AND status IN ('approved', 'match_pending');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Lead is no longer in an earnable state'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bonus_amount', p_bonus_amount,
    'synergy_order_number', v_synergy_order_number
  );
END;
$$;

-- Preserve the migration-047 / migration-135 grant posture (the API calls this
-- with the session client; execution is restricted to authenticated + service_role).
REVOKE ALL ON FUNCTION confirm_match_candidate(UUID, UUID, TEXT, NUMERIC, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_match_candidate(UUID, UUID, TEXT, NUMERIC, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_match_candidate(UUID, UUID, TEXT, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_match_candidate(UUID, UUID, TEXT, NUMERIC, UUID) TO service_role;
