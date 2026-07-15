-- 144_purchasing_delete_own.sql
-- Let a purchasing user delete their OWN reorder walks (created_by_id = them),
-- in addition to super_admin/manager who can delete any walk. reorder_sessions
-- .created_by_id stores the auth user id (users.id = auth.users.id), so
-- auth.uid() is the correct comparison. DROP + CREATE (not ALTER) keeps the
-- migration self-contained and matches the repo's policy-change pattern.

DROP POLICY IF EXISTS reorder_sessions_delete ON reorder_sessions;

CREATE POLICY reorder_sessions_delete ON reorder_sessions
  FOR DELETE
  TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['super_admin'::text, 'manager'::text])
    OR (get_user_role() = 'purchasing'::text AND created_by_id = auth.uid())
  );
