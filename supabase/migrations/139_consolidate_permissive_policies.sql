-- 139_consolidate_permissive_policies.sql
--
-- Consolidate overlapping PERMISSIVE RLS policies (Supabase advisor lint
-- multiple_permissive_policies — the last 2026-07-01 audit P2). Postgres
-- evaluates EVERY applicable permissive policy per row and ORs the results,
-- so a table with a staff policy + a tech policy for the same action pays
-- for both on every row. This migration merges each such group into ONE
-- policy per (table, action) whose expression is the mechanical OR of the
-- originals. Semantics are identical by construction: every expression below
-- is copied verbatim from the live pg_policies decompiled output.
--
-- Also, on the tables this migration touches:
--   - ALL policies ("Staff manage X") are split into per-action policies so
--     each action ends up with exactly one permissive policy
--     (equipment, pm_schedules, pm_tickets, settings).
--   - Policies created without TO (role {public}) are retargeted
--     TO authenticated. Behavior-identical: every expression requires
--     get_user_role() / auth.uid(), which are NULL for anon — but anon no
--     longer evaluates them at all.
--   - WITH CHECK handling on merged UPDATE policies: a policy without
--     WITH CHECK reuses USING, and OR-merging preserves that. The only merged
--     UPDATE policy that had an explicit WITH CHECK ("Technicians update
--     equipment") is handled by giving equipment_update an explicit
--     WITH CHECK equal to its USING — the same thing the old pair enforced.
--
-- NOT touched: single-policy tables (contacts, customers, vendors, products,
-- sales_reps, device_pins, notifications, push_subscriptions,
-- equipment_sale_lead_candidates, feedback_submissions, ship_to_requests,
-- supply_catalog non-SELECT, sync_log, synergy_po_lines, audit_events,
-- equipment_prospects, technician_targets, customer_notes,
-- equipment_estimate_log, equipment_location_history, equipment_notes,
-- ship_to_locations) and the RESTRICTIVE settings_hide_secret_keys policy.
--
-- Access parity verified empirically on dev before prod: per-role SELECT and
-- SELECT ... FOR UPDATE row counts + INSERT probes identical before/after.

-- ---------------------------------------------------------------------------
-- ace_labor_entries: staff/tech pairs on INSERT, SELECT, UPDATE; all {public}.
DROP POLICY ace_labor_staff_insert ON public.ace_labor_entries;
DROP POLICY ace_labor_tech_insert ON public.ace_labor_entries;
CREATE POLICY ace_labor_insert ON public.ace_labor_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text]))
    OR ((get_user_role() = 'technician'::text) AND (tech_id = (SELECT auth.uid())) AND (status = 'pending'::text))
  );

DROP POLICY ace_labor_staff_select ON public.ace_labor_entries;
DROP POLICY ace_labor_tech_select ON public.ace_labor_entries;
CREATE POLICY ace_labor_select ON public.ace_labor_entries
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (tech_id = (SELECT auth.uid())))
  );

DROP POLICY ace_labor_staff_update ON public.ace_labor_entries;
DROP POLICY ace_labor_tech_update ON public.ace_labor_entries;
CREATE POLICY ace_labor_update ON public.ace_labor_entries
  FOR UPDATE TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text]))
    OR ((get_user_role() = 'technician'::text) AND (tech_id = (SELECT auth.uid())) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text])))
  );

ALTER POLICY ace_labor_super_admin_delete ON public.ace_labor_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- credit_reviews: manager + tech SELECT pair.
DROP POLICY credit_reviews_manager_select ON public.credit_reviews;
DROP POLICY credit_reviews_tech_select ON public.credit_reviews;
CREATE POLICY credit_reviews_select ON public.credit_reviews
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (((pm_ticket_id IS NOT NULL) AND (EXISTS ( SELECT 1
       FROM pm_tickets t
      WHERE ((t.id = credit_reviews.pm_ticket_id) AND (t.assigned_technician_id = (SELECT auth.uid())))))) OR ((service_ticket_id IS NOT NULL) AND (EXISTS ( SELECT 1
       FROM service_tickets s
      WHERE ((s.id = credit_reviews.service_ticket_id) AND (s.assigned_technician_id = (SELECT auth.uid()))))))))
  );

-- ---------------------------------------------------------------------------
-- equipment: split the staff ALL policy; merge the tech SELECT/UPDATE arms.
DROP POLICY "Staff manage equipment" ON public.equipment;
DROP POLICY "Technicians read equipment" ON public.equipment;
DROP POLICY "Technicians update equipment" ON public.equipment;
CREATE POLICY equipment_select ON public.equipment
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR (get_user_role() = 'technician'::text)
  );
CREATE POLICY equipment_insert ON public.equipment
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY equipment_update ON public.equipment
  FOR UPDATE TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR (get_user_role() = 'technician'::text)
  )
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR (get_user_role() = 'technician'::text)
  );
CREATE POLICY equipment_delete ON public.equipment
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));

-- ---------------------------------------------------------------------------
-- pm_schedules: split the staff ALL policy; merge the tech SELECT arm.
DROP POLICY "Staff manage schedules" ON public.pm_schedules;
DROP POLICY "Technicians read schedules" ON public.pm_schedules;
CREATE POLICY pm_schedules_select ON public.pm_schedules
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR (get_user_role() = 'technician'::text)
  );
CREATE POLICY pm_schedules_insert ON public.pm_schedules
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY pm_schedules_update ON public.pm_schedules
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY pm_schedules_delete ON public.pm_schedules
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));

-- ---------------------------------------------------------------------------
-- pm_tickets: split the staff ALL policy; merge two tech SELECT arms + the
-- tech UPDATE arm.
DROP POLICY "Staff manage tickets" ON public.pm_tickets;
DROP POLICY "Technicians read completed tickets for shared equipment" ON public.pm_tickets;
DROP POLICY "Technicians see own tickets" ON public.pm_tickets;
DROP POLICY "Technicians update own tickets" ON public.pm_tickets;
CREATE POLICY pm_tickets_select ON public.pm_tickets
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (assigned_technician_id = (SELECT auth.uid())))
    OR ((get_user_role() = 'technician'::text) AND (status = ANY (ARRAY['completed'::text, 'billed'::text])) AND (equipment_id IN ( SELECT get_tech_equipment_ids() AS get_tech_equipment_ids)))
  );
CREATE POLICY pm_tickets_insert ON public.pm_tickets
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY pm_tickets_update ON public.pm_tickets
  FOR UPDATE TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (assigned_technician_id = (SELECT auth.uid())))
  );
CREATE POLICY pm_tickets_delete ON public.pm_tickets
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));

-- ---------------------------------------------------------------------------
-- service_tickets: staff/tech pairs on INSERT, SELECT, UPDATE; all {public}.
DROP POLICY service_tickets_staff_insert ON public.service_tickets;
DROP POLICY service_tickets_tech_insert ON public.service_tickets;
CREATE POLICY service_tickets_insert ON public.service_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND current_user_can_create_service_tickets() AND (created_by_id = (SELECT auth.uid())) AND (assigned_technician_id = (SELECT auth.uid())) AND (ticket_type = 'outside'::text))
  );

DROP POLICY service_tickets_staff_select ON public.service_tickets;
DROP POLICY service_tickets_tech_select ON public.service_tickets;
CREATE POLICY service_tickets_select ON public.service_tickets
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND ((assigned_technician_id = (SELECT auth.uid())) OR ((status = ANY (ARRAY['completed'::text, 'billed'::text])) AND (equipment_id IN ( SELECT get_tech_equipment_ids() AS get_tech_equipment_ids)))))
  );

DROP POLICY service_tickets_staff_update ON public.service_tickets;
DROP POLICY service_tickets_tech_update ON public.service_tickets;
CREATE POLICY service_tickets_update ON public.service_tickets
  FOR UPDATE TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (assigned_technician_id = (SELECT auth.uid())))
  );

ALTER POLICY service_tickets_staff_delete ON public.service_tickets TO authenticated;

-- ---------------------------------------------------------------------------
-- settings: split the staff ALL policy. The existing SELECT-true policy
-- ("Authenticated users can read settings") already subsumes the ALL policy's
-- SELECT arm (true OR staff = true), so SELECT keeps that single policy.
-- The RESTRICTIVE settings_hide_secret_keys policy is untouched and still
-- ANDs over reads.
DROP POLICY "Managers can update settings" ON public.settings;
CREATE POLICY settings_insert ON public.settings
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY settings_update ON public.settings
  FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));
CREATE POLICY settings_delete ON public.settings
  FOR DELETE TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]));

-- ---------------------------------------------------------------------------
-- supply_requests: staff/tech SELECT pair (INSERT/UPDATE/DELETE are already
-- single-policy).
DROP POLICY supply_requests_staff_select ON public.supply_requests;
DROP POLICY supply_requests_tech_select ON public.supply_requests;
CREATE POLICY supply_requests_select ON public.supply_requests
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (requested_by = (SELECT auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- tech_leads: staff/tech pairs on INSERT + SELECT; all {public}.
DROP POLICY tech_leads_staff_insert ON public.tech_leads;
DROP POLICY tech_leads_tech_insert ON public.tech_leads;
CREATE POLICY tech_leads_insert ON public.tech_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text]))
    OR ((get_user_role() = 'technician'::text) AND (submitted_by = (SELECT auth.uid())) AND (status = 'pending'::text))
  );

DROP POLICY tech_leads_staff_select ON public.tech_leads;
DROP POLICY tech_leads_tech_select ON public.tech_leads;
CREATE POLICY tech_leads_select ON public.tech_leads
  FOR SELECT TO authenticated
  USING (
    (get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text, 'coordinator'::text]))
    OR ((get_user_role() = 'technician'::text) AND (submitted_by = (SELECT auth.uid())))
  );

ALTER POLICY tech_leads_staff_update ON public.tech_leads TO authenticated;
ALTER POLICY tech_leads_super_admin_delete ON public.tech_leads TO authenticated;

-- ---------------------------------------------------------------------------
-- users: "Bootstrap first manager" + users_insert INSERT pair. Merged
-- mechanically — NOTE this preserves the pre-existing quirk that the bootstrap
-- arm lets any manager insert a user row of ANY role (including super_admin).
-- Kept as-is because this migration is a pure consolidation; tightening the
-- bootstrap arm is a separate product decision.
DROP POLICY "Bootstrap first manager" ON public.users;
DROP POLICY users_insert ON public.users;
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    ((NOT (EXISTS ( SELECT 1
       FROM users users_1
      WHERE (users_1.role = 'manager'::text)))) OR (get_user_role() = 'manager'::text))
    OR ((get_user_role() = 'super_admin'::text) OR ((get_user_role() = 'manager'::text) AND (role = ANY (ARRAY['manager'::text, 'coordinator'::text, 'technician'::text]))))
  );
