-- 135_security_hardening.sql
--
-- Closes the 2026-07-01 audit's DB-level findings (Supabase security advisor):
--
-- 1. Twelve SECURITY DEFINER functions were executable by `anon` (and several
--    by `authenticated`) via PostgREST /rest/v1/rpc — unauthenticated callers
--    could invoke privileged mutations directly, bypassing the API layer.
--    Lock each function down to exactly the roles that actually call it:
--      - service_role      → always (admin-client + tooling callers)
--      - authenticated     → only functions the app calls with the session
--                            client or that RLS policies/triggers evaluate as
--                            the querying role
--      - anon / PUBLIC     → never
-- 2. customer_notes INSERT policy was WITH CHECK (true) — any authenticated
--    user could insert a note attributed to any other user. Bind user_id to
--    the caller and require an office role (API already enforces
--    MANAGER_ROLES; this makes the DB agree).
-- 3. Five trigger functions had a mutable search_path (advisor 0011).
-- 4. Token lookups (customer estimate approval, credit-review action) were
--    sequential scans — add partial indexes.

-- ---------------------------------------------------------------------------
-- 1a. Functions the app calls with the SESSION client, or that RLS policies /
--     the migration-048 trigger evaluate as the querying role: keep
--     authenticated, drop anon/PUBLIC, ensure service_role.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.fn_update_parts_queue(text, uuid, timestamptz, jsonb)',       -- parts-queue/update route (session client)
    'public.fn_complete_pm_ticket(jsonb)',                                -- tickets/[id]/complete route (session client)
    'public.fn_approve_tech_lead_email(uuid, uuid, uuid, uuid[], text)',  -- tech-leads approve-and-email route (session client)
    'public.confirm_match_candidate(uuid, uuid, text, numeric, uuid)',    -- tech-leads candidate confirm route (session client)
    'public.get_user_role()',                                             -- RLS policies + migration-048 field-lock trigger
    'public.get_tech_equipment_ids()',                                    -- technician RLS policies (pm/service tickets, equipment)
    'public.current_user_can_create_service_tickets()'                    -- service_tickets RLS
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 1b. Functions only ever invoked via the service-role admin client, tooling,
--     or as trigger bodies (trigger execution does not require caller
--     EXECUTE): drop anon + authenticated + PUBLIC, ensure service_role.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.relocate_equipment_for_pm(uuid, integer, uuid, text)',        -- tickets/[id]/relocate route (admin client)
    'public.relocate_equipment_for_service(uuid, integer, uuid, text)',   -- service-tickets/[id]/relocate route (admin client)
    'public.conn_snapshot()',                                             -- perf-investigation diagnostic (tooling only)
    'public.audit_capture()',                                             -- trigger function
    'public.earn_tech_lead_on_pm_completion()'                            -- trigger function
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. customer_notes: bind the note to its author and require an office role.
--    The app (createCustomerNote) always inserts user_id = the caller, so this
--    changes nothing for legitimate writes — it only closes the direct
--    PostgREST path where any signed-in user could forge attribution.
DROP POLICY IF EXISTS "Authenticated insert customer_notes" ON customer_notes;
CREATE POLICY "Authenticated insert customer_notes"
  ON customer_notes FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.get_user_role() = ANY (ARRAY['super_admin', 'manager', 'coordinator'])
  );

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on the trigger functions the advisor flagged as mutable
--    (0011_function_search_path_mutable).
ALTER FUNCTION public.lock_paid_lead_fields() SET search_path = public;
ALTER FUNCTION public.restrict_tech_equipment_updates() SET search_path = public;
ALTER FUNCTION public.feedback_submissions_set_updated_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at_credit_reviews() SET search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Token lookups run once per customer click but were full scans. Partial
--    indexes keep them O(log n) as the tables grow; NULL rows (the vast
--    majority — tokens are nulled after use) cost nothing.
CREATE INDEX IF NOT EXISTS idx_service_tickets_approval_token
  ON service_tickets (approval_token) WHERE approval_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_reviews_action_token
  ON credit_reviews (action_token) WHERE action_token IS NOT NULL;
