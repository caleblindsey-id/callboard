-- Pay a payout period (payout module unification, Round 3)
--
-- One transaction settles everything a period owes: the commission, the lead
-- bonuses underneath it, and the ACE labor that fed the subtotal.
--
-- WHAT THIS REPLACES. Two near-identical routes, /api/tech-leads/payout/
-- mark-paid and /api/ace-labor/payout/mark-paid, each doing a fetch-then-CAS
-- and returning 409 on a partial write while LEAVING THE PARTIAL WRITE IN
-- PLACE. Neither knew about the other, so July 2026 had its leads and ACE
-- marked paid on one screen while the commission that actually pays them sat
-- unpaid on another. Both routes derived the payout_period by slicing the first
-- seven characters off whatever end-date happened to be in a date picker.
--
-- WHY IT WALKS THE MANIFEST. payout_lines already carries a source_id for every
-- ACE entry and every earned lead in the period. Paying reads those exact ids
-- rather than re-running the window query, so whatever changed between lock and
-- pay -- a late invoice, a newly approved entry -- cannot reach a period that
-- has already been snapshotted. That work belongs to the next open period.
--
-- ALL OR NOTHING. Any row not in the status the manifest expects raises, and
-- the whole transaction rolls back. There is no partially-paid period.

CREATE OR REPLACE FUNCTION fn_pay_payout_period(
  p_period TEXT,
  p_user   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id  UUID;
  v_status     TEXT;
  v_now        TIMESTAMPTZ := now();
  v_lead_ids   UUID[];
  v_ace_ids    UUID[];
  v_leads_paid INT := 0;
  v_ace_paid   INT := 0;
  v_expected   INT;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'NO_USER: paying requires an acting user'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status INTO v_period_id, v_status
  FROM payout_periods WHERE period = p_period
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LOCKED: % must be locked before it can be paid', p_period
      USING ERRCODE = '02000';
  END IF;

  IF v_status = 'paid' THEN
    RAISE EXCEPTION 'ALREADY_PAID: % was paid already', p_period
      USING ERRCODE = '23505';
  END IF;

  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'NOT_LOCKED: % is %, only a locked period can be paid', p_period, v_status
      USING ERRCODE = '40001';
  END IF;

  -- The manifest. Everything below settles exactly these ids and nothing else.
  SELECT array_agg(DISTINCT source_id) INTO v_lead_ids
  FROM payout_lines
  WHERE payout_period_id = v_period_id AND source_kind = 'tech_lead' AND source_id IS NOT NULL;

  SELECT array_agg(DISTINCT source_id) INTO v_ace_ids
  FROM payout_lines
  WHERE payout_period_id = v_period_id AND source_kind = 'ace_labor_entry' AND source_id IS NOT NULL;

  -- ----- lead bonuses: earned -> paid -----
  -- The one transition lock_paid_lead_fields() (migration 047) permits while
  -- also writing paid_at / paid_by / payout_period, which is precisely why
  -- payout_period is stamped here and not at lock time.
  IF v_lead_ids IS NOT NULL THEN
    v_expected := array_length(v_lead_ids, 1);

    UPDATE tech_leads
    SET status = 'paid', paid_at = v_now, paid_by = p_user, payout_period = p_period
    WHERE id = ANY(v_lead_ids) AND status = 'earned';

    GET DIAGNOSTICS v_leads_paid = ROW_COUNT;

    IF v_leads_paid <> v_expected THEN
      RAISE EXCEPTION
        'LEAD_STATE_CHANGED: % of % leads were still earned; nothing has been paid',
        v_leads_paid, v_expected
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- ----- ACE labor: approved -> paid -----
  -- ACE is a commission BASIS, not a separate payment. Marking it paid records
  -- that the period it fed has been settled; the dollars reached the tech
  -- through the tiered commission, or through nothing at all if the tech is not
  -- commission eligible.
  IF v_ace_ids IS NOT NULL THEN
    v_expected := array_length(v_ace_ids, 1);

    UPDATE ace_labor_entries
    SET status = 'paid', paid_at = v_now, paid_by_id = p_user,
        payout_period = p_period, updated_by_id = p_user
    WHERE id = ANY(v_ace_ids) AND status = 'approved';

    GET DIAGNOSTICS v_ace_paid = ROW_COUNT;

    IF v_ace_paid <> v_expected THEN
      RAISE EXCEPTION
        'ACE_STATE_CHANGED: % of % entries were still approved; nothing has been paid',
        v_ace_paid, v_expected
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE payout_periods
  SET status = 'paid', paid_at = v_now, paid_by_id = p_user, updated_by_id = p_user
  WHERE id = v_period_id;

  RETURN jsonb_build_object(
    'period', p_period,
    'leads_paid', v_leads_paid,
    'ace_paid', v_ace_paid
  );
END;
$$;

COMMENT ON FUNCTION fn_pay_payout_period(TEXT, UUID) IS
  'Settle a locked payout period in one transaction: flips every tech_lead in its manifest '
  'from earned to paid and every ace_labor_entry from approved to paid, stamping payout_period '
  'on each, then marks the period paid. Walks payout_lines rather than re-querying, so nothing '
  'that arrived after the lock can be swept in. Raises and rolls back on any unexpected state '
  'rather than leaving a period half paid.';

REVOKE ALL ON FUNCTION fn_pay_payout_period(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_pay_payout_period(TEXT, UUID) TO authenticated;
