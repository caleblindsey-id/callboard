-- Migration 062: ACE labor tracking.
--
-- Some tickets get billed to the customer at no charge (warranty work,
-- complimentary service, etc.) but the tech still did the labor. The "ACE"
-- program pays techs out monthly for that otherwise-uncompensated work.
--
-- This migration adds a single new table, ace_labor_entries, that:
--   - holds one entry per ticket (PM or service) — enforced by partial unique
--     indexes on each FK
--   - snapshots labor_rate_type at submission so later ticket edits don't
--     shift the entry's rate category
--   - snapshots the dollar value of the rate at *approval* time
--     (rate_value_at_approval) so a settings change later doesn't rewrite
--     history on the payout report
--   - flows status: pending -> approved -> paid, with rejected as a side path
--     that lets the tech edit and resubmit
--
-- The payout report (/tech-leads PayoutReport.tsx) reads this table alongside
-- the existing tech_leads pool. Whoever runs payroll multiplies hours by
-- rate_value_at_approval to get the billable value and applies the tech's
-- off-system commission percentage.

-- ---------------------------------------------------------------------------
-- 1. ace_labor_entries table
-- ---------------------------------------------------------------------------
CREATE TABLE ace_labor_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ticket linkage. Exactly one of pm_ticket_id / service_ticket_id is set.
  pm_ticket_id      UUID REFERENCES pm_tickets(id)      ON DELETE CASCADE,
  service_ticket_id UUID REFERENCES service_tickets(id) ON DELETE CASCADE,
  CONSTRAINT ace_labor_one_ticket_chk CHECK (
    (pm_ticket_id IS NOT NULL)::int + (service_ticket_id IS NOT NULL)::int = 1
  ),

  -- Submitter (denormalized off the ticket for fast filtering on the
  -- payout report and /ace-labor page).
  tech_id UUID NOT NULL REFERENCES users(id),

  -- Entry content
  hours              DECIMAL(5,2) NOT NULL CHECK (hours > 0),
  labor_rate_type    TEXT NOT NULL
    CHECK (labor_rate_type IN ('standard', 'industrial', 'vacuum')),
  reason             TEXT NOT NULL CHECK (length(trim(reason)) > 0),

  -- Status & approval
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by_id    UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  rejected_reason   TEXT,
  rate_value_at_approval DECIMAL(6,2),  -- snapshotted from settings on approve

  -- Payout
  paid_at        TIMESTAMPTZ,
  paid_by_id     UUID REFERENCES users(id),
  payout_period  TEXT,  -- 'YYYY-MM'

  -- Audit attribution (read by audit_capture() fallback when neither
  -- app.acting_user_id GUC nor auth.uid() is set — admin-client writes).
  updated_by_id  UUID REFERENCES users(id),
  created_by_id  UUID REFERENCES users(id),

  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ace_labor_entries IS
  'Tech-submitted ACE labor on no-charge tickets. One row per ticket. '
  'Flows pending -> approved -> paid, with rejected as a side path. '
  'Read by /ace-labor approval queue and /tech-leads payout report.';

COMMENT ON COLUMN ace_labor_entries.labor_rate_type IS
  'Snapshotted from the parent ticket at submission so later ticket edits '
  'do not shift the entry''s rate category.';

COMMENT ON COLUMN ace_labor_entries.rate_value_at_approval IS
  'Dollar value of labor_rate_type at approval time, pulled from the '
  'settings table. Snapshotted so later rate changes do not rewrite '
  'historic payout totals.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
-- One ACE entry per ticket — enforced at the DB layer via partial unique
-- indexes (CHECK constraint already requires exactly one FK set).
CREATE UNIQUE INDEX idx_ace_labor_pm_ticket_unique
  ON ace_labor_entries (pm_ticket_id)
  WHERE pm_ticket_id IS NOT NULL;

CREATE UNIQUE INDEX idx_ace_labor_service_ticket_unique
  ON ace_labor_entries (service_ticket_id)
  WHERE service_ticket_id IS NOT NULL;

-- Payout report queries: filter approved entries by approved_at in a range.
CREATE INDEX idx_ace_labor_status_approved_at
  ON ace_labor_entries (status, approved_at DESC);

-- Tech-facing views (their submitted entries).
CREATE INDEX idx_ace_labor_tech_id
  ON ace_labor_entries (tech_id);

-- ---------------------------------------------------------------------------
-- 3. Auto-update updated_at (reuse existing helper)
-- ---------------------------------------------------------------------------
CREATE TRIGGER set_ace_labor_entries_updated_at
  BEFORE UPDATE ON ace_labor_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — mirrors the tech_leads pattern
-- ---------------------------------------------------------------------------
ALTER TABLE ace_labor_entries ENABLE ROW LEVEL SECURITY;

-- Staff read: super_admin, manager, coordinator all see the full queue.
-- Coordinator stays read-only (no write policy below).
CREATE POLICY ace_labor_staff_select ON ace_labor_entries
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Staff write: super_admin + manager (approve, reject, mark paid).
CREATE POLICY ace_labor_staff_update ON ace_labor_entries
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager'));

-- Staff insert: super_admin + manager can enter an entry on a tech's behalf.
CREATE POLICY ace_labor_staff_insert ON ace_labor_entries
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'manager'));

-- Super_admin can hard-delete.
CREATE POLICY ace_labor_super_admin_delete ON ace_labor_entries
  FOR DELETE USING (get_user_role() = 'super_admin');

-- Techs see only their own entries.
CREATE POLICY ace_labor_tech_select ON ace_labor_entries
  FOR SELECT USING (
    get_user_role() = 'technician'
    AND tech_id = auth.uid()
  );

-- Techs insert their own entries (must be self + start pending).
CREATE POLICY ace_labor_tech_insert ON ace_labor_entries
  FOR INSERT WITH CHECK (
    get_user_role() = 'technician'
    AND tech_id = auth.uid()
    AND status = 'pending'
  );

-- Techs update their own entries ONLY while status is pending or rejected
-- (lets them fix and resubmit after a rejection). approve/reject/mark-paid
-- transitions go through admin-client API routes that bypass RLS.
CREATE POLICY ace_labor_tech_update ON ace_labor_entries
  FOR UPDATE USING (
    get_user_role() = 'technician'
    AND tech_id = auth.uid()
    AND status IN ('pending', 'rejected')
  );

-- ---------------------------------------------------------------------------
-- 5. Audit trigger — wire into the existing audit_capture() pipeline
-- ---------------------------------------------------------------------------
-- zz_ prefix so the audit trigger fires last (after set_updated_at and any
-- future business triggers), matching the pattern from migration 058.
DROP TRIGGER IF EXISTS zz_audit_ace_labor_entries_trg ON ace_labor_entries;
CREATE TRIGGER zz_audit_ace_labor_entries_trg
  AFTER INSERT OR UPDATE OR DELETE ON ace_labor_entries
  FOR EACH ROW EXECUTE FUNCTION audit_capture();
