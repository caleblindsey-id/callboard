-- Migration 092: read-only accessor for the applied-migration set, powering the
-- migration-drift checker (scripts/check-migration-drift.mjs).
--
-- Why this exists: migrations on this project are applied manually / out-of-band
-- (there is no CI step that runs them). That let migration 073
-- (073_tech_leads_structured_equipment) be authored and merged but never applied
-- to prod — so every tech-lead submission 500'd, because the deployed API writes
-- the columns 073 adds (make/model/serial_number/…) on every insert and they did
-- not exist (feedback #21).
--
-- The applied set lives in supabase_migrations.schema_migrations, which is NOT
-- exposed through PostgREST, so a service-role client cannot read it directly.
-- This SECURITY DEFINER function exposes just (version, name) so the drift
-- checker can compare the database against supabase/migrations/*.sql and turn a
-- silent gap into a loud failure.

CREATE OR REPLACE FUNCTION public.applied_migrations()
RETURNS TABLE (version TEXT, name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = supabase_migrations, public
AS $$
  SELECT version, name
  FROM supabase_migrations.schema_migrations
  ORDER BY version
$$;

-- Service-role only — this is a tooling accessor, never for end users.
REVOKE ALL ON FUNCTION public.applied_migrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.applied_migrations() TO service_role;

COMMENT ON FUNCTION public.applied_migrations() IS
  'Returns applied migrations (version, name) from supabase_migrations.schema_migrations. service_role only; powers scripts/check-migration-drift.mjs. Added in migration 092 after feedback #21 (073 drift).';
