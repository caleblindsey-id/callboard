-- Migration 077: Hide secret settings keys from non-super_admin readers.
--
-- The settings table SELECT policy is PERMISSIVE USING(true) for all
-- authenticated users (migration 006). That means migration 076's
-- credit_hold_release_passcode_hash — the scrypt hash of the shared release
-- passcode — was readable by ANY logged-in user (including technicians) via the
-- browser anon client, enabling offline brute-force and defeating the
-- manager-unblock control.
--
-- Add a RESTRICTIVE SELECT policy (AND-ed with the existing permissive one) that
-- hides any key matching '%passcode_hash%' from everyone except super_admin.
-- Non-secret keys (labor rates, branding, ar_email) stay readable as before.
-- Server-side reads of the hash use the service-role admin client, which
-- bypasses RLS entirely, so the unblock/verify flow is unaffected.

DROP POLICY IF EXISTS settings_hide_secret_keys ON settings;
CREATE POLICY settings_hide_secret_keys
  ON settings AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (key NOT LIKE '%passcode_hash%' OR get_user_role() = 'super_admin');
