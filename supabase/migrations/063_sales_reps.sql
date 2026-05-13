-- Migration 063: Sales reps directory.
--
-- Holds the list of outside sales reps a manager can forward an approved
-- equipment-sale tech lead to. Reps are NOT CallBoard users — they receive
-- an email and never log in. If the model ever needs reps to act inside the
-- app, promote to a 'sales_rep' user role + assignment FK on tech_leads.

CREATE TABLE sales_reps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name  TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  email TEXT NOT NULL UNIQUE CHECK (length(email) <= 320 AND email LIKE '%@%.%'),

  active BOOLEAN NOT NULL DEFAULT true,

  -- Audit attribution (read by audit_capture() when neither
  -- app.acting_user_id GUC nor auth.uid() is set — admin-client writes).
  updated_by_id UUID REFERENCES users(id),
  created_by_id UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales_reps IS
  'Outside sales reps who can be emailed an approved equipment lead. '
  'Not CallBoard users — only an email destination.';

CREATE INDEX idx_sales_reps_active ON sales_reps (active) WHERE active = true;

CREATE TRIGGER set_sales_reps_updated_at
  BEFORE UPDATE ON sales_reps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales_reps ENABLE ROW LEVEL SECURITY;

-- Staff read: super_admin + manager (the people who route leads).
CREATE POLICY sales_reps_staff_select ON sales_reps
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager'));

-- Super_admin manages the list.
CREATE POLICY sales_reps_admin_insert ON sales_reps
  FOR INSERT WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY sales_reps_admin_update ON sales_reps
  FOR UPDATE USING (get_user_role() = 'super_admin');

CREATE POLICY sales_reps_admin_delete ON sales_reps
  FOR DELETE USING (get_user_role() = 'super_admin');

-- Audit trigger — zz_ prefix so it fires after set_updated_at.
DROP TRIGGER IF EXISTS zz_audit_sales_reps_trg ON sales_reps;
CREATE TRIGGER zz_audit_sales_reps_trg
  AFTER INSERT OR UPDATE OR DELETE ON sales_reps
  FOR EACH ROW EXECUTE FUNCTION audit_capture();
