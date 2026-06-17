-- Widen audit_events read access from super_admin-only to super_admin + manager.
-- Managers can now pull the change history (the WO timeline) without raw SQL.
-- Coordinators remain excluded. Full log: no entity_type restriction, so manager
-- sees user/customer/equipment/ticket/schedule changes just like super_admin.
--
-- Writes are unchanged: there is still no INSERT/UPDATE/DELETE policy — every
-- write flows through the SECURITY DEFINER audit trigger, which bypasses RLS.
-- Original policy created in 058_audit_events.sql. Uses get_user_role() (004_fixes.sql).

DROP POLICY IF EXISTS audit_events_super_admin_select ON audit_events;

CREATE POLICY audit_events_select
  ON audit_events FOR SELECT
  TO authenticated
  USING (get_user_role() = ANY (ARRAY['super_admin', 'manager']));
