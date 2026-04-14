-- Migration 027: Service Tickets Module
-- Work order numbers share the pm_tickets_wo_seq sequence (nextval)

-- 1. Create table with explicitly named FK constraints for PostgREST join syntax
CREATE TABLE service_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships (named constraints for PostgREST)
  customer_id INTEGER NOT NULL,
  equipment_id UUID,
  assigned_technician_id UUID,
  created_by_id UUID,

  CONSTRAINT service_tickets_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT service_tickets_equipment_id_fkey
    FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT service_tickets_assigned_technician_id_fkey
    FOREIGN KEY (assigned_technician_id) REFERENCES users(id),
  CONSTRAINT service_tickets_created_by_id_fkey
    FOREIGN KEY (created_by_id) REFERENCES users(id),

  -- Classification
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('inside', 'outside')),
  billing_type TEXT NOT NULL DEFAULT 'time_and_materials'
    CHECK (billing_type IN ('time_and_materials', 'warranty', 'partial_warranty')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'estimated', 'approved', 'in_progress', 'completed', 'billed', 'declined', 'canceled')),
  priority TEXT NOT NULL DEFAULT 'standard'
    CHECK (priority IN ('emergency', 'standard', 'low')),

  -- Intake
  problem_description TEXT NOT NULL,
  contact_name VARCHAR,
  contact_email VARCHAR,
  contact_phone VARCHAR,

  -- Service location (for outside/field tickets)
  service_address VARCHAR,
  service_city VARCHAR,
  service_state VARCHAR,
  service_zip VARCHAR,

  -- Equipment (inline for unknown equipment, used when equipment_id is NULL)
  equipment_make VARCHAR,
  equipment_model VARCHAR,
  equipment_serial_number VARCHAR,

  -- Diagnosis & Estimate
  diagnosis_notes TEXT,
  estimate_amount DECIMAL(10,2),
  estimate_approved BOOLEAN DEFAULT FALSE,
  estimate_approved_at TIMESTAMPTZ,
  auto_approved BOOLEAN DEFAULT FALSE,

  -- Parts Request & Fulfillment
  parts_requested JSONB DEFAULT '[]'::jsonb,
  parts_received BOOLEAN DEFAULT FALSE,

  -- Synergy Integration
  synergy_order_number VARCHAR,
  synergy_po_number VARCHAR,

  -- Work Completion
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  hours_worked DECIMAL(5,2),
  parts_used JSONB DEFAULT '[]'::jsonb,
  warranty_labor_covered BOOLEAN DEFAULT FALSE,
  completion_notes TEXT,
  customer_signature TEXT,
  customer_signature_name VARCHAR,
  photos JSONB DEFAULT '[]'::jsonb,

  -- Billing
  billing_amount DECIMAL(10,2),
  diagnostic_charge DECIMAL(10,2),

  -- Inside ticket
  awaiting_pickup BOOLEAN DEFAULT FALSE,
  picked_up_at TIMESTAMPTZ,

  -- Tracking
  work_order_number INTEGER DEFAULT nextval('pm_tickets_wo_seq'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Auto-update timestamp trigger (reuse existing set_updated_at function)
CREATE TRIGGER set_service_tickets_updated_at
  BEFORE UPDATE ON service_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Performance indexes
CREATE INDEX idx_service_tickets_customer ON service_tickets(customer_id);
CREATE INDEX idx_service_tickets_equipment ON service_tickets(equipment_id);
CREATE INDEX idx_service_tickets_technician ON service_tickets(assigned_technician_id);
CREATE INDEX idx_service_tickets_status ON service_tickets(status);
CREATE INDEX idx_service_tickets_billing_type ON service_tickets(billing_type);
CREATE INDEX idx_service_tickets_created_at ON service_tickets(created_at);

-- 4. Enable RLS
ALTER TABLE service_tickets ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (all use get_user_role() SECURITY DEFINER function)

-- Staff (super_admin, manager, coordinator) can read all
CREATE POLICY service_tickets_staff_select ON service_tickets
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Staff can insert
CREATE POLICY service_tickets_staff_insert ON service_tickets
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Staff can update all
CREATE POLICY service_tickets_staff_update ON service_tickets
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Only managers can delete
CREATE POLICY service_tickets_staff_delete ON service_tickets
  FOR DELETE USING (get_user_role() IN ('super_admin', 'manager'));

-- Techs can see own assigned + completed/billed for shared equipment
CREATE POLICY service_tickets_tech_select ON service_tickets
  FOR SELECT USING (
    get_user_role() = 'technician'
    AND (
      assigned_technician_id = auth.uid()
      OR status IN ('completed', 'billed')
    )
  );

-- Techs can update own assigned tickets only
CREATE POLICY service_tickets_tech_update ON service_tickets
  FOR UPDATE USING (
    get_user_role() = 'technician'
    AND assigned_technician_id = auth.uid()
  );

-- 6. Update get_tech_equipment_ids() to include service tickets
CREATE OR REPLACE FUNCTION get_tech_equipment_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT equipment_id FROM pm_tickets
    WHERE assigned_technician_id = auth.uid() AND equipment_id IS NOT NULL
  UNION
  SELECT DISTINCT equipment_id FROM service_tickets
    WHERE assigned_technician_id = auth.uid() AND equipment_id IS NOT NULL
$$;
