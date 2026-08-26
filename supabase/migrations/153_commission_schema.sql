-- Migration 153: commission schema (tech payouts, Round 2)
--
-- CallBoard already owns three of the four technician payout buckets:
-- ace_labor_entries, tech_leads (PM + equipment-sale bonuses), and
-- equipment_sale_lead_candidates. The fourth and largest -- commission on billed
-- labor -- has never existed on-system. It lives in a hand-built Excel workbook
-- fed by a Phocas browser scrape. This migration adds the tables that let
-- CallBoard hold it.
--
-- SCHEMA ONLY. No tier math, no sync, no UI. Round 3 fills synergy_labor_facts,
-- Round 4 computes payout_lines and builds the report. Nothing reads these tables
-- yet, so this migration is inert on deploy.
--
-- An earlier brainstorm deliberately kept commission math OFF-system (recorded in
-- wiki/knowledge/callboard-ace-labor.md). This reverses that decision.
--
-- Extraction recipe proven in Round 1 (June 2026 penny-exact, 11 techs):
-- projects/work/tech-payouts/analysis/ROUND-1-FINDINGS.md in the Compass repo.
--
-- ---------------------------------------------------------------------------
-- DESIGN NOTES -- read these before extending
-- ---------------------------------------------------------------------------
--
-- 1. SNAPSHOT AT LOCK. Follows the precedent already in the codebase
--    (ace_labor_entries.rate_value_at_approval, tech_leads.bonus_amount): the
--    rate is COPIED onto the payout line, never re-derived. Tickets store only
--    labor_rate_type, so recomputing hours x rate reads the CURRENT settings
--    value and silently restates closed months. payout_lines.rate_at_lock and
--    basis_subtotal_at_lock exist precisely to stop that.
--
-- 2. TIER BOUNDARIES ARE CLIFFS, NOT BRACKETS. The rate applies to the WHOLE
--    subtotal, so $7,499 earns $374.95 and $7,500 earns $562.50. Round 1 found a
--    3% attribution error that produced a 62% commission error. Tier bounds here
--    are HALF-OPEN [min, max) with max NULL meaning unbounded, which removes the
--    cent-gap a min/max-inclusive pair would leave between 4999.99 and 5000.00.
--    Do not "fix" these to inclusive upper bounds.
--
-- 3. PERIOD IS CENTRAL-ANCHORED 'YYYY-MM', ON INVOICE DATE. BUSINESS_TIME_ZONE is
--    America/Chicago while getInvoicedRows and PayoutReport.tsx bucket in UTC. A
--    ticket billed 7:30 PM Central on the last of the month lands in the next
--    month under UTC. Whatever fills these tables must anchor to Central and
--    apply it consistently to billed_at, earned_at, and approved_at.
--
-- 4. SOFT DELETE. pm_tickets and service_tickets are soft-deleted and RLS does
--    NOT hide them. Any query that builds payout_lines from tickets needs an
--    explicit .is('deleted_at', null) or techs get paid for deleted work. The AST
--    checker does not cover embedded joins or .rpc().
--
-- 5. NO TECH-FACING ACCESS. RLS below is super_admin + manager only. Coordinator
--    is deliberately excluded even though it has read access to ace_labor_entries
--    -- this is whole-branch compensation data. Tech-facing views of their own
--    commission are explicitly out of scope for this build.

-- ---------------------------------------------------------------------------
-- 1. commission_tiers -- effective-dated rate table
-- ---------------------------------------------------------------------------
-- Effective-dated so a rate change does not restate closed months. Seeded from
-- the written plan "Outside Service Technician Commission Structure", effective
-- 2022-11-01, whose own workbook formulas (=5000*F5, =8000*G5) confirm the
-- whole-subtotal cliff.
CREATE TABLE commission_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  effective_from DATE NOT NULL,

  -- Half-open band: [min_subtotal, max_subtotal). NULL max = unbounded.
  min_subtotal DECIMAL(12,2) NOT NULL CHECK (min_subtotal >= 0),
  max_subtotal DECIMAL(12,2),
  CONSTRAINT commission_tiers_band_chk
    CHECK (max_subtotal IS NULL OR max_subtotal > min_subtotal),

  -- Fraction, not percent: 0.0250 = 2.5%.
  rate DECIMAL(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),

  notes TEXT,

  created_by_id UUID REFERENCES users(id),
  updated_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT commission_tiers_effective_min_uniq UNIQUE (effective_from, min_subtotal)
);

COMMENT ON TABLE commission_tiers IS
  'Effective-dated commission rate bands. The rate applies to the WHOLE commissioned '
  'subtotal, so boundaries are cliffs: $7,499 pays 5%, $7,500 pays 7.5% on everything. '
  'Bands are half-open [min_subtotal, max_subtotal), max NULL = unbounded. Seeded from '
  'the 2022-11-01 written plan. Never edit a historic effective_from row -- insert a new '
  'effective_from set instead, or closed months restate.';

COMMENT ON COLUMN commission_tiers.rate IS
  'Fraction not percent. 0.0250 = 2.5%. Snapshotted onto payout_lines.rate_at_lock '
  'when a period locks so later changes here cannot rewrite a paid month.';

COMMENT ON COLUMN commission_tiers.max_subtotal IS
  'EXCLUSIVE upper bound. NULL means unbounded. Half-open by design -- an inclusive '
  'pair would leave a cent-wide gap between 4999.99 and 5000.00, and on a cliff table '
  'that gap is a real dollar error.';

INSERT INTO commission_tiers (effective_from, min_subtotal, max_subtotal, rate, notes) VALUES
  ('2022-11-01',      0.00,   3000.00, 0.0000, 'Under $3,000 earns no commission'),
  ('2022-11-01',   3000.00,   5000.00, 0.0250, '$3,000 to $4,999.99'),
  ('2022-11-01',   5000.00,   7500.00, 0.0500, '$5,000 to $7,499.99'),
  ('2022-11-01',   7500.00,  10000.00, 0.0750, '$7,500 to $9,999.99'),
  ('2022-11-01',  10000.00,      NULL, 0.1000, '$10,000 and up');

-- ---------------------------------------------------------------------------
-- 2. users.commission_eligible + optional per-tech override
-- ---------------------------------------------------------------------------
-- Replaces policy data that lived in spreadsheet cells: the workbook hardcodes
-- 407 Jeff Verberne and 410 Bob Brashears to 0%, treats 406 Steven King as
-- inactive, and 444 SHOP TEAM is not a real technician.
--
-- NOTE users.active is COSMETIC -- it is not checked by getCurrentUser or
-- proxy.ts, so it does not mean "still employed" (Keith Bradley is the
-- precedent). Do not infer commission eligibility from it.
ALTER TABLE users
  ADD COLUMN commission_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN commission_rate_override DECIMAL(5,4)
    CHECK (commission_rate_override IS NULL
           OR (commission_rate_override >= 0 AND commission_rate_override <= 1));

COMMENT ON COLUMN users.commission_eligible IS
  'Whether this user earns tiered commission on billed labor. Defaults false: '
  'eligibility is opt-in so a new user never silently starts accruing. Replaces the '
  'hardcoded 0% cells in Shop Commission 2026.xlsx.';

COMMENT ON COLUMN users.commission_rate_override IS
  'Flat rate that REPLACES the commission_tiers lookup for this user, as a fraction. '
  'NULL = use the tier table (the normal case). Exists for a negotiated off-table rate; '
  'no current tech uses one.';

-- Seed from the workbook's own treatment, verified against Round 1.
UPDATE users SET commission_eligible = true
 WHERE synergy_id IN ('401','402','403','404','405','408','409','411');

-- Explicitly non-commissioned. Left false, stated here so the intent is on record
-- rather than looking like an omission:
--   407 Jeff Verberne  -- workbook forces 0%
--   410 Bob Brashears  -- workbook forces 0%
--   406 Steven King    -- inactive
--   444 SHOP TEAM      -- not a real technician

-- ---------------------------------------------------------------------------
-- 3. payout_periods -- the lockable month
-- ---------------------------------------------------------------------------
-- Locking is what makes a month immutable and reconcilable. The written plan
-- calculates commission on the first business day of the following month and pays
-- it on the last payroll of that month, which is exactly when a period is safe to
-- lock. The ERP replica also lags one day, so never lock before the first business
-- day of the following month.
CREATE TABLE payout_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Central-anchored 'YYYY-MM'. Matches the payout_period convention already used
  -- by tech_leads and ace_labor_entries.
  period TEXT NOT NULL UNIQUE
    CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'locked', 'paid')),

  locked_at    TIMESTAMPTZ,
  locked_by_id UUID REFERENCES users(id),
  paid_at      TIMESTAMPTZ,
  paid_by_id   UUID REFERENCES users(id),

  notes TEXT,

  created_by_id UUID REFERENCES users(id),
  updated_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A locked or paid period must record who locked it and when.
  CONSTRAINT payout_periods_locked_fields_chk CHECK (
    status = 'draft' OR (locked_at IS NOT NULL AND locked_by_id IS NOT NULL)
  )
);

COMMENT ON TABLE payout_periods IS
  'One row per payout month, period as Central-anchored YYYY-MM. draft -> locked -> paid. '
  'Locking freezes the month: payout_lines carry snapshotted rates so a later rate or '
  'settings change cannot restate a locked period. Also the answer to the billed_at '
  'reopen problem -- a billed -> completed -> billed cycle would otherwise move a ticket '
  'out of an already-paid month into a later one.';

-- ---------------------------------------------------------------------------
-- 4. payout_lines -- one row per contributing dollar
-- ---------------------------------------------------------------------------
-- Auditable back to a ticket, an ACE entry, a lead, or a Synergy invoice.
--
-- kind separates the three roles a line plays, so the report never has to infer
-- them from category:
--   basis      -- counts toward the commissioned subtotal (tiered)
--   commission -- the computed tier payout itself
--   bonus      -- flat, added AFTER the percentage (workbook row 14)
CREATE TABLE payout_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  payout_period_id UUID NOT NULL REFERENCES payout_periods(id) ON DELETE CASCADE,
  tech_id          UUID NOT NULL REFERENCES users(id),

  kind TEXT NOT NULL CHECK (kind IN ('basis', 'commission', 'bonus')),

  category TEXT NOT NULL CHECK (category IN (
    -- kind = 'basis'
    'labor_shop', 'labor_warranty', 'trip_charge', 'pm_labor', 'ace_labor',
    -- kind = 'commission'
    'commission',
    -- kind = 'bonus'
    'pm_bonus', 'equipment_bonus'
  )),

  -- Keep kind and category consistent. Without this a bonus row could be
  -- miscategorised as basis and silently inflate the tiered subtotal.
  CONSTRAINT payout_lines_kind_category_chk CHECK (
    (kind = 'basis' AND category IN
       ('labor_shop','labor_warranty','trip_charge','pm_labor','ace_labor'))
    OR (kind = 'commission' AND category = 'commission')
    OR (kind = 'bonus' AND category IN ('pm_bonus','equipment_bonus'))
  ),

  -- Signed. Credit memos and clawbacks are negative.
  amount DECIMAL(12,2) NOT NULL,

  -- Provenance. source_id points at a CallBoard row when there is one;
  -- source_ref carries a non-UUID external key (a Synergy invoice number).
  source_kind TEXT CHECK (source_kind IN
    ('pm_ticket','service_ticket','ace_labor_entry','tech_lead','synergy_invoice','manual')),
  source_id   UUID,
  source_ref  TEXT,

  -- Snapshots taken at lock. Populated on the 'commission' line.
  rate_at_lock            DECIMAL(5,4),
  basis_subtotal_at_lock  DECIMAL(12,2),

  note TEXT,

  created_by_id UUID REFERENCES users(id),
  updated_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payout_lines IS
  'One row per contributing dollar on a tech''s payout, auditable back to its source. '
  'kind = basis feeds the tiered subtotal, kind = commission is the computed tier payout, '
  'kind = bonus is flat and added AFTER the percentage. Total = commission + sum(bonus).';

COMMENT ON COLUMN payout_lines.amount IS
  'Signed. Negative for credit memos and reversals -- Synergy Status 31 credit memos net '
  'against Status 30 invoices, which is how the workbook''s Phocas totals already behave.';

COMMENT ON COLUMN payout_lines.rate_at_lock IS
  'commission_tiers.rate (or users.commission_rate_override) COPIED at lock time. Never '
  're-derive a locked line from the tier table -- that is the whole point of the column.';

COMMENT ON COLUMN payout_lines.basis_subtotal_at_lock IS
  'The commissioned subtotal the rate was chosen from. Stored so a reader can verify the '
  'tier selection without re-summing basis lines, and so a tier-boundary dispute is '
  'settleable from one row.';

-- One commission line per tech per period. Basis and bonus lines are many.
CREATE UNIQUE INDEX idx_payout_lines_one_commission_per_tech
  ON payout_lines (payout_period_id, tech_id)
  WHERE kind = 'commission';

-- FK indexes: Postgres does not create these automatically, and both are the
-- join path for every report query.
--
-- Deliberately NOT indexed: created_by_id, updated_by_id, locked_by_id,
-- paid_by_id. The Supabase linter flags them as unindexed FKs (INFO), and that
-- is expected -- 146 such findings already exist across this database, 50 of them
-- on created_by/updated_by. Migration 136 (fk_join_indexes) indexed only the
-- columns that are real join paths. Writer-attribution columns are never joined
-- on in a report, and users are deactivated rather than hard-deleted, so an index
-- there buys nothing and costs write throughput. Do not "fix" the lint.
CREATE INDEX idx_payout_lines_period ON payout_lines (payout_period_id);
CREATE INDEX idx_payout_lines_tech   ON payout_lines (tech_id);

-- The report's main read: a period's lines grouped by tech and kind.
CREATE INDEX idx_payout_lines_period_tech_kind
  ON payout_lines (payout_period_id, tech_id, kind);

-- Trace a ticket back to what it paid (dispute resolution).
CREATE INDEX idx_payout_lines_source
  ON payout_lines (source_kind, source_id)
  WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. synergy_labor_facts -- Round 3 sync staging
-- ---------------------------------------------------------------------------
-- Written by the Round 3 sync, which ports the proven Round 1 extractor into
-- scripts/sync/ alongside synergy-sync.py. Keyed on (synergy_id, period, bucket)
-- so a re-run for a still-open month REFRESHES rather than doubles.
--
-- Keys on synergy_id (varchar, the 400-450 sslsm codes) rather than users.id
-- because the extractor reads the ERP and should not need a CallBoard user to
-- exist before it can land a row.
CREATE TABLE synergy_labor_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  synergy_id TEXT NOT NULL,
  period     TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- Mirrors the Round 1 ProdCode split:
  --   labor_shop     444000000 LABOR SHOP, OrdType 22 (non-warranty)
  --   labor_warranty 444000000 LABOR SHOP, OrdType 21 (warranty)
  --   trip_charge    444000300 TRIP CHARGE
  --   pm_labor       444000400 PM  -- see pm_factor_applied below
  --   diagnostic_fee 444000001 DIAGNOSTIC FEE, not on the workbook, $0 in June
  bucket TEXT NOT NULL CHECK (bucket IN
    ('labor_shop','labor_warranty','trip_charge','pm_labor','diagnostic_fee')),

  amount DECIMAL(12,2) NOT NULL,

  -- PM is taken at a flat 85%: Phocas "PM Profit Est." is a standing 15% parts
  -- allowance, NOT value minus actual parts. Netting real P210 parts was wrong in
  -- both directions; the flat factor held to the penny for every tech and month
  -- tested. Recorded per row so a future factor change is visible in the data.
  pm_factor_applied DECIMAL(5,4),

  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT synergy_labor_facts_key_uniq UNIQUE (synergy_id, period, bucket)
);

COMMENT ON TABLE synergy_labor_facts IS
  'Staging for invoiced labor pulled from Synergy, one row per tech per period per '
  'bucket. Idempotent on (synergy_id, period, bucket) so re-running an open month '
  'refreshes rather than doubles. Synergy is the AUTHORITY for billed labor dollars; '
  'CallBoard applies tier math on top. Recipe: attribution is invh.Slsm1 (NOT invl.Slsm '
  '-- that error was 3% on a subtotal and 62% on a commission), scope OrdType IN (21,22) '
  'with Ot19Comp = 0, signed by invh.Status (30 invoice +, 31 credit memo -).';

COMMENT ON COLUMN synergy_labor_facts.synergy_id IS
  'The sslsm code (401-411, 444), matching users.synergy_id. Deliberately not a FK to '
  'users -- the ERP extractor should be able to land a row for a tech CallBoard has not '
  'been told about yet, and that gap should surface as a reconciliation error, not a '
  'failed insert.';

CREATE INDEX idx_synergy_labor_facts_period ON synergy_labor_facts (period);

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers (reuse the existing helper)
-- ---------------------------------------------------------------------------
CREATE TRIGGER set_commission_tiers_updated_at
  BEFORE UPDATE ON commission_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_payout_periods_updated_at
  BEFORE UPDATE ON payout_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_payout_lines_updated_at
  BEFORE UPDATE ON payout_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_synergy_labor_facts_updated_at
  BEFORE UPDATE ON synergy_labor_facts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS -- super_admin + manager only
-- ---------------------------------------------------------------------------
-- Deliberately narrower than ace_labor_entries, which grants coordinator read.
-- These tables expose whole-branch compensation. auth.uid() is not referenced
-- anywhere below, so there is no initplan concern (migration 138); get_user_role()
-- is already the established helper.
ALTER TABLE commission_tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_periods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE synergy_labor_facts  ENABLE ROW LEVEL SECURITY;

-- commission_tiers: staff read, super_admin-only write (it is rate policy).
DROP POLICY IF EXISTS commission_tiers_select ON commission_tiers;
CREATE POLICY commission_tiers_select ON commission_tiers
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

-- Split per-action rather than FOR ALL: a FOR ALL policy would overlap the SELECT
-- policy above and reintroduce the multiple-permissive-policies lint that
-- migration 139 was written to clean up.
DROP POLICY IF EXISTS commission_tiers_super_admin_insert ON commission_tiers;
CREATE POLICY commission_tiers_super_admin_insert ON commission_tiers
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS commission_tiers_super_admin_update ON commission_tiers;
CREATE POLICY commission_tiers_super_admin_update ON commission_tiers
  FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS commission_tiers_super_admin_delete ON commission_tiers;
CREATE POLICY commission_tiers_super_admin_delete ON commission_tiers
  FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- payout_periods: super_admin + manager read and write (manager runs payroll prep).
DROP POLICY IF EXISTS payout_periods_select ON payout_periods;
CREATE POLICY payout_periods_select ON payout_periods
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_periods_insert ON payout_periods;
CREATE POLICY payout_periods_insert ON payout_periods
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_periods_update ON payout_periods;
CREATE POLICY payout_periods_update ON payout_periods
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_periods_super_admin_delete ON payout_periods;
CREATE POLICY payout_periods_super_admin_delete ON payout_periods
  FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- payout_lines: same audience as the period they belong to.
DROP POLICY IF EXISTS payout_lines_select ON payout_lines;
CREATE POLICY payout_lines_select ON payout_lines
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_lines_insert ON payout_lines;
CREATE POLICY payout_lines_insert ON payout_lines
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_lines_update ON payout_lines;
CREATE POLICY payout_lines_update ON payout_lines
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS payout_lines_super_admin_delete ON payout_lines;
CREATE POLICY payout_lines_super_admin_delete ON payout_lines
  FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- synergy_labor_facts: read-only to humans. The Round 3 sync writes with the
-- service-role client, which bypasses RLS, so no write policy is granted here.
DROP POLICY IF EXISTS synergy_labor_facts_select ON synergy_labor_facts;
CREATE POLICY synergy_labor_facts_select ON synergy_labor_facts
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

-- ---------------------------------------------------------------------------
-- 8. Audit triggers -- wire into the existing audit_capture() pipeline
-- ---------------------------------------------------------------------------
-- zz_ prefix so the audit trigger fires last, matching migration 058.
-- synergy_labor_facts is deliberately NOT audited: it is machine-written staging
-- refreshed on every sync, so auditing it would bury real changes in sync noise.
DROP TRIGGER IF EXISTS zz_audit_commission_tiers_trg ON commission_tiers;
CREATE TRIGGER zz_audit_commission_tiers_trg
  AFTER INSERT OR UPDATE OR DELETE ON commission_tiers
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_payout_periods_trg ON payout_periods;
CREATE TRIGGER zz_audit_payout_periods_trg
  AFTER INSERT OR UPDATE OR DELETE ON payout_periods
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

DROP TRIGGER IF EXISTS zz_audit_payout_lines_trg ON payout_lines;
CREATE TRIGGER zz_audit_payout_lines_trg
  AFTER INSERT OR UPDATE OR DELETE ON payout_lines
  FOR EACH ROW EXECUTE FUNCTION audit_capture();
