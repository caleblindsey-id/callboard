-- Migration 037: Tech Lead Bonus Tracking (v1: PM Lead Bonus)
--
-- Tracks tech-submitted leads for putting a customer's equipment on a PM schedule.
-- Bonus earns when the first PM on the linked equipment completes, and only if the
-- linked pm_schedule is flat_rate + interval_months IN (1,2,3) — i.e. monthly,
-- bi-monthly, or quarterly. Semi-annual (6) and annual (12) never earn.
--
-- The lead_type column reserves space for a v2 'equipment_sale' bonus program
-- (tech flags an aging machine, we sell a replacement) without a schema change.

CREATE TABLE tech_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification
  lead_type TEXT NOT NULL DEFAULT 'pm'
    CHECK (lead_type IN ('pm', 'equipment_sale')),

  -- Submitter
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tech_leads_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES users(id),

  -- Customer linkage (existing customer OR free-text new customer; exactly one)
  customer_id INTEGER,
  customer_name_text TEXT,
  CONSTRAINT tech_leads_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT tech_leads_customer_one_set_chk
    CHECK (
      customer_id IS NOT NULL
      OR (customer_name_text IS NOT NULL AND length(trim(customer_name_text)) > 0)
    ),

  -- Lead content
  equipment_description TEXT NOT NULL,
  proposed_pm_frequency TEXT,
  notes TEXT,

  -- Status & approval
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'earned', 'paid')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  cancelled_reason TEXT,
  CONSTRAINT tech_leads_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES users(id),

  -- Equipment link (set when manager creates the equipment from the lead)
  equipment_id UUID,
  CONSTRAINT tech_leads_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES equipment(id),

  -- Earn (locked in by the 038 trigger on first eligible PM completion)
  bonus_amount DECIMAL(10,2),
  earned_at TIMESTAMPTZ,
  earned_from_ticket_id UUID,
  CONSTRAINT tech_leads_earned_from_ticket_id_fkey
    FOREIGN KEY (earned_from_ticket_id) REFERENCES pm_tickets(id),

  -- Payout
  paid_at TIMESTAMPTZ,
  paid_by UUID,
  payout_period TEXT,
  CONSTRAINT tech_leads_paid_by_fkey
    FOREIGN KEY (paid_by) REFERENCES users(id),

  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one lead per equipment record can earn a bonus
CREATE UNIQUE INDEX idx_tech_leads_equipment_unique
  ON tech_leads(equipment_id)
  WHERE equipment_id IS NOT NULL;

-- Auto-update timestamp (reuse existing set_updated_at function)
CREATE TRIGGER set_tech_leads_updated_at
  BEFORE UPDATE ON tech_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes for common queries
CREATE INDEX idx_tech_leads_submitted_by ON tech_leads(submitted_by);
CREATE INDEX idx_tech_leads_status ON tech_leads(status);
CREATE INDEX idx_tech_leads_customer_id ON tech_leads(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_tech_leads_earned_at ON tech_leads(earned_at) WHERE earned_at IS NOT NULL;

-- Enable RLS
ALTER TABLE tech_leads ENABLE ROW LEVEL SECURITY;

-- Staff read: super_admin, manager, and coordinator all see the full queue.
-- Coordinators are read-only (no update/insert policy below); they need visibility
-- for planning but do not have approval authority.
CREATE POLICY tech_leads_staff_select ON tech_leads
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Staff write: only super_admin + manager can approve, reject, cancel, mark paid.
-- The earn trigger (038) runs as SECURITY DEFINER and bypasses this policy.
CREATE POLICY tech_leads_staff_update ON tech_leads
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager'));

-- Staff insert: super_admin + manager (e.g., entering a lead on behalf of a tech)
CREATE POLICY tech_leads_staff_insert ON tech_leads
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'manager'));

-- Super_admin can hard-delete (e.g., duplicate cleanup)
CREATE POLICY tech_leads_super_admin_delete ON tech_leads
  FOR DELETE USING (get_user_role() = 'super_admin');

-- Techs see their own leads
CREATE POLICY tech_leads_tech_select ON tech_leads
  FOR SELECT USING (
    get_user_role() = 'technician'
    AND submitted_by = auth.uid()
  );

-- Techs insert their own leads (must submit as self, must start as pending)
CREATE POLICY tech_leads_tech_insert ON tech_leads
  FOR INSERT WITH CHECK (
    get_user_role() = 'technician'
    AND submitted_by = auth.uid()
    AND status = 'pending'
  );

COMMENT ON TABLE tech_leads IS
  'Tech-submitted leads for bonus tracking. v1 = PM lead bonus. Bonus auto-earns on first completed PM if schedule is flat_rate + interval_months IN (1,2,3). Office payout via /tech-leads payout report.';
