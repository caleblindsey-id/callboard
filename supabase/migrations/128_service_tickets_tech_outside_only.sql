-- Technicians may only create Outside (Field) service tickets.
--
-- Inside (bench/shop) tickets originate in the office; a field technician keying
-- an inside ticket is out of process. Migration 109 added the tech INSERT policy
-- (self-assigned, flag-gated). This recreates it with one extra clause so the
-- database independently rejects a tech-created inside ticket — the same
-- belt-and-suspenders approach already used for self-assignment, which is
-- enforced at both the API route and this policy.
--
-- The application layer (POST /api/service-tickets coerces ticket_type to
-- 'outside' for techs, and the create form hides the inside/outside choice for
-- techs) keeps this from ever being hit in normal use; this is the DB-side guard.
--
-- OR'd with service_tickets_staff_insert, so managers/coordinators/super_admins
-- keep both inside and outside on create.

DROP POLICY IF EXISTS service_tickets_tech_insert ON service_tickets;

CREATE POLICY service_tickets_tech_insert ON service_tickets
  FOR INSERT WITH CHECK (
    get_user_role() = 'technician'
    AND current_user_can_create_service_tickets()
    AND created_by_id = auth.uid()
    AND assigned_technician_id = auth.uid()
    AND ticket_type = 'outside'
  );
