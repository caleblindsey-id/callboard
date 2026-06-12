-- Permitted technicians may create service tickets (feedback #39).
--
-- PR #110 (migration 108) added users.can_create_service_tickets and opened the
-- /service/new page, the POST /api/service-tickets route, and the board's "New
-- Service Ticket" button to a technician whose flag is set — but never added a
-- matching RLS INSERT policy. The route inserts under the user's own
-- (RLS-bound) session, so every flagged technician's submit was rejected with
--   "new row violates row-level security policy for table service_tickets"
-- even though the application layer allowed it.
--
-- This adds the missing DB-side grant. A permitted technician may insert only a
-- ticket they created (created_by_id = auth.uid()) and assigned to themselves
-- (assigned_technician_id = auth.uid()). Self-assignment keeps this consistent
-- with the tech SELECT/UPDATE policies — in particular it lets the route's
-- post-insert .select() read the new row back under service_tickets_tech_select.

-- SECURITY DEFINER helper so the policy can read the per-tech flag without being
-- blocked by the users table's own RLS (mirrors get_user_role()).
CREATE OR REPLACE FUNCTION current_user_can_create_service_tickets()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT can_create_service_tickets FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- Permissive INSERT policy — OR'd with service_tickets_staff_insert, so managers
-- are unaffected. Only a flagged technician creating their own self-assigned
-- ticket satisfies this check.
CREATE POLICY service_tickets_tech_insert ON service_tickets
  FOR INSERT WITH CHECK (
    get_user_role() = 'technician'
    AND current_user_can_create_service_tickets()
    AND created_by_id = auth.uid()
    AND assigned_technician_id = auth.uid()
  );
