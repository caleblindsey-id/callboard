-- Payout period lock (payout module unification, Round 2)
--
-- payout_periods and payout_lines have existed since migration 153 with zero
-- code references. This is what wires them up.
--
-- WHY LOCKING EXISTS. Until now the payout report recomputed on every page
-- load, so the 5:45 AM Synergy labor sync could restate a month that had
-- already been paid, and a reopened ticket could move a tech's tier after the
-- fact. Locking snapshots the period into payout_lines. A locked period is read
-- from that snapshot and can no longer move.
--
-- WHY THE MATH IS NOT IN HERE. The tier table is a set of CLIFFS applied to the
-- whole subtotal, so a one-cent disagreement between two implementations is
-- worth up to $187.50. src/lib/commission/tiers.ts is the only implementation,
-- it has 21 tests, and it reproduces the manual workbook penny-exact for June
-- and July 2026. Re-deriving any of it in PL/pgSQL would create a second
-- implementation to keep in sync, which is the exact failure this whole
-- refactor is undoing. So the API route computes the report server-side and
-- passes the finished lines in; this function's job is to VALIDATE them and
-- write them atomically. The payload never reaches a browser.
--
-- payout_lines is a MANIFEST, not just a report snapshot. Every ACE entry and
-- every earned lead gets its own line carrying source_id. Paying the period
-- (migration 156) walks those ids rather than re-running the window query, so
-- nothing can drift between lock and pay.

-- ---------------------------------------------------------------------------
-- 1. Constrain the two legacy payout_period columns
-- ---------------------------------------------------------------------------
-- Both have carried free text since 2026-04. The only writer derived the value
-- from whatever end-date happened to be in a date picker
-- (`isoDate.slice(0, 7)`), with no validation and no timezone anchoring. Every
-- row currently in prod happens to be well-formed, so these are additive.

ALTER TABLE tech_leads
  ADD CONSTRAINT tech_leads_payout_period_chk
  CHECK (payout_period IS NULL OR payout_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE ace_labor_entries
  ADD CONSTRAINT ace_labor_entries_payout_period_chk
  CHECK (payout_period IS NULL OR payout_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- ---------------------------------------------------------------------------
-- 2. Audit tech_leads
-- ---------------------------------------------------------------------------
-- ace_labor_entries, commission_tiers, payout_periods and payout_lines all
-- carry audit_capture() triggers. tech_leads never did, despite being the table
-- that holds bonus_amount. Closing that gap before anything starts writing to
-- it automatically.

DROP TRIGGER IF EXISTS zz_audit_tech_leads_trg ON tech_leads;
CREATE TRIGGER zz_audit_tech_leads_trg
  AFTER INSERT OR UPDATE OR DELETE ON tech_leads
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

-- ---------------------------------------------------------------------------
-- 3. fn_lock_payout_period
-- ---------------------------------------------------------------------------
-- p_lines is the payout_lines payload, already computed by the API route from
-- getCommissionReport(). Shape, per element:
--
--   { tech_id, kind, category, amount,
--     source_kind?, source_id?, source_ref?,
--     rate_at_lock?, basis_subtotal_at_lock?, note? }
--
-- Returns the new payout_periods row id.
--
-- SECURITY DEFINER because payout_lines is RLS'd to super_admin + manager and
-- this runs behind an API route that has already checked the role. Callers are
-- server-side only.

CREATE OR REPLACE FUNCTION fn_lock_payout_period(
  p_period TEXT,
  p_user   UUID,
  p_lines  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_count     INT;
  v_bad       TEXT;
BEGIN
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'BAD_PERIOD: % is not YYYY-MM', p_period
      USING ERRCODE = '22023';
  END IF;

  IF p_user IS NULL THEN
    RAISE EXCEPTION 'NO_USER: locking requires an acting user'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'NO_LINES: refusing to lock % with nothing to snapshot', p_period
      USING ERRCODE = '22023';
  END IF;

  -- Idempotency guard. Re-locking would double the manifest and pay twice.
  IF EXISTS (SELECT 1 FROM payout_periods WHERE period = p_period) THEN
    RAISE EXCEPTION 'ALREADY_LOCKED: % has already been locked', p_period
      USING ERRCODE = '23505';
  END IF;

  -- Every ACE entry in the manifest must still be approved. If one was paid by
  -- some other path, or rejected since the report was computed, the snapshot is
  -- already stale and locking it would pay against a moved target.
  SELECT string_agg(DISTINCT a.id::text, ', ') INTO v_bad
  FROM jsonb_to_recordset(p_lines) AS l(source_kind TEXT, source_id UUID)
  JOIN ace_labor_entries a ON a.id = l.source_id
  WHERE l.source_kind = 'ace_labor_entry' AND a.status <> 'approved';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ACE_NOT_APPROVED: entries no longer approved: %', v_bad
      USING ERRCODE = '40001';
  END IF;

  -- Same for leads: every bonus line must point at a lead still sitting in
  -- 'earned'. A lead already 'paid' means another period claimed it.
  SELECT string_agg(DISTINCT t.id::text, ', ') INTO v_bad
  FROM jsonb_to_recordset(p_lines) AS l(source_kind TEXT, source_id UUID)
  JOIN tech_leads t ON t.id = l.source_id
  WHERE l.source_kind = 'tech_lead' AND t.status <> 'earned';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'LEAD_NOT_EARNED: leads no longer earned: %', v_bad
      USING ERRCODE = '40001';
  END IF;

  -- A source row may appear in exactly one period, ever. This is the structural
  -- guard against paying the same ACE entry or lead in two months.
  SELECT string_agg(DISTINCT l.source_id::text, ', ') INTO v_bad
  FROM jsonb_to_recordset(p_lines) AS l(source_kind TEXT, source_id UUID)
  JOIN payout_lines pl
    ON pl.source_id = l.source_id AND pl.source_kind = l.source_kind
  WHERE l.source_id IS NOT NULL;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED: already on a locked period: %', v_bad
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO payout_periods (period, status, locked_at, locked_by_id, created_by_id, updated_by_id)
  VALUES (p_period, 'locked', now(), p_user, p_user, p_user)
  RETURNING id INTO v_period_id;

  INSERT INTO payout_lines (
    payout_period_id, tech_id, kind, category, amount,
    source_kind, source_id, source_ref,
    rate_at_lock, basis_subtotal_at_lock, note,
    created_by_id, updated_by_id
  )
  SELECT
    v_period_id, l.tech_id, l.kind, l.category, l.amount,
    l.source_kind, l.source_id, l.source_ref,
    l.rate_at_lock, l.basis_subtotal_at_lock, l.note,
    p_user, p_user
  FROM jsonb_to_recordset(p_lines) AS l(
    tech_id UUID,
    kind TEXT,
    category TEXT,
    amount NUMERIC,
    source_kind TEXT,
    source_id UUID,
    source_ref TEXT,
    rate_at_lock NUMERIC,
    basis_subtotal_at_lock NUMERIC,
    note TEXT
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> jsonb_array_length(p_lines) THEN
    -- Unreachable in practice; a mismatch would mean a NULL tech_id silently
    -- dropped a row, and a partial manifest must never survive.
    RAISE EXCEPTION 'LINE_COUNT_MISMATCH: wrote % of %', v_count, jsonb_array_length(p_lines)
      USING ERRCODE = '23514';
  END IF;

  RETURN v_period_id;
END;
$$;

COMMENT ON FUNCTION fn_lock_payout_period(TEXT, UUID, JSONB) IS
  'Snapshot a payout period into payout_lines and mark it locked. The lines are computed by '
  'src/lib/commission (the single tier implementation) and passed in; this validates and '
  'writes them in one transaction. Raises ALREADY_LOCKED, ACE_NOT_APPROVED, LEAD_NOT_EARNED '
  'or ALREADY_CLAIMED rather than writing a partial manifest.';

-- ---------------------------------------------------------------------------
-- 4. fn_unlock_payout_period
-- ---------------------------------------------------------------------------
-- Escape hatch for a lock taken too early, NOT a routine path. Refuses once the
-- period is paid: at that point money has left, and the answer to a late
-- arrival is the next open period, not restating a closed one.
--
-- Deliberately does not check the caller's role -- the API route gates that to
-- super_admin. Kept here as a single-purpose primitive.

CREATE OR REPLACE FUNCTION fn_unlock_payout_period(
  p_period TEXT,
  p_user   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_status    TEXT;
BEGIN
  SELECT id, status INTO v_period_id, v_status
  FROM payout_periods WHERE period = p_period;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LOCKED: % has never been locked', p_period
      USING ERRCODE = '02000';
  END IF;

  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'NOT_UNLOCKABLE: % is %, only a locked period can be reopened', p_period, v_status
      USING ERRCODE = '40001';
  END IF;

  -- ON DELETE CASCADE clears payout_lines with it.
  DELETE FROM payout_periods WHERE id = v_period_id;
END;
$$;

COMMENT ON FUNCTION fn_unlock_payout_period(TEXT, UUID) IS
  'Discard a locked period and its lines so it can be recomputed. Refuses on a paid period: '
  'a month that has been paid is settled, and late arrivals belong to the next open period.';

REVOKE ALL ON FUNCTION fn_lock_payout_period(TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_unlock_payout_period(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_lock_payout_period(TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_unlock_payout_period(TEXT, UUID) TO authenticated;
