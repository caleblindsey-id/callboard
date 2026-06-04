#!/usr/bin/env node
// Migration-drift checker.
//
// Flags any migration in supabase/migrations/*.sql that has no corresponding row
// in the database's applied set (supabase_migrations.schema_migrations, read via
// the public.applied_migrations RPC added in migration 092).
//
// Why this exists: migrations on this project are applied manually / out-of-band
// — there is no CI step that runs them. Migration 073
// (073_tech_leads_structured_equipment) was authored and merged but never applied
// to prod, so every tech-lead submission 500'd: the deployed API writes the
// columns 073 adds (make/model/serial_number/…) on every insert and they did not
// exist (feedback #21). This check turns that silent gap into a loud failure.
//
// Usage:  npm run check:migrations
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the env or
// .env.local. Exits 0 when clean, 1 on drift, 2 on a setup/connection problem.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(repoRoot, 'supabase', 'migrations')

// Repo migrations confirmed applied whose presence the name-match heuristic below
// can't see — either they predate schema_migrations tracking (baseline 001–006)
// or their recorded name diverges from the repo filename. Allowlisting them keeps
// the check quiet in normal operation so a genuine gap (like 073 was) stands out.
// Add an entry ONLY after confirming the migration's effect is live in the DB.
const ALLOWLIST = new Set([
  '001_initial_schema',   // baseline — applied before schema_migrations tracking
  '002_rls_policies',     // baseline
  '003_indexes',          // baseline
  '004_fixes',            // baseline
  '005_interval_schedule', // baseline
  '006_settings_table',   // baseline
  '007_skip_status',      // recorded as "add_skipped_status"
  '011_service_requests', // recorded as "service_request_tickets"
  '014_default_products_on_equipment',     // recorded as "add_default_products_to_equipment"
  '015_po_and_billing_contact_on_tickets', // recorded as "add_po_and_billing_contact_to_tickets"
  '016_contact_fields_on_equipment',       // recorded as "add_contact_fields_to_equipment"
])

// Strip a leading numeric prefix (e.g. "073_", "020a_") to get the descriptive name.
const descName = (s) => s.replace(/^\d+[a-z]?[_-]/, '')

// Minimal .env.local loader so the script runs without an extra dependency.
// Real environment variables take precedence.
function loadEnvLocal() {
  let text
  try {
    text = readFileSync(join(repoRoot, '.env.local'), 'utf8')
  } catch {
    return // no .env.local — rely on the real environment
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let val = m[2]
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'check-migration-drift: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY ' +
        '(set them in the environment or .env.local).'
    )
    process.exit(2)
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('applied_migrations')
  if (error) {
    console.error('check-migration-drift: could not read applied migrations:', error.message)
    console.error('Ensure migration 092 (public.applied_migrations) is applied to this database.')
    process.exitCode = 2
    return
  }

  const applied = (data ?? []).map((r) => r.name).filter(Boolean)
  const appliedDesc = new Set(applied.map(descName))

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const drift = []
  for (const f of files) {
    const stem = f.replace(/\.sql$/, '')
    if (ALLOWLIST.has(stem)) continue
    const desc = descName(stem)
    // Applied if the descriptive name matches exactly, or appears within a
    // recorded name (covers suffixes like "…_round_f").
    const matched = appliedDesc.has(desc) || applied.some((a) => a.includes(desc))
    if (!matched) drift.push(stem)
  }

  if (drift.length === 0) {
    console.log(
      `✓ No migration drift. ${files.length} repo migrations, ${applied.length} applied.`
    )
    return // exitCode defaults to 0
  }

  console.error('✗ Migration drift detected — these repo migrations have no applied row:')
  for (const d of drift) console.error(`  - ${d}`)
  console.error(
    '\nApply them to the database, or — if confirmed already applied under a different ' +
      'name — add the stem to ALLOWLIST in this script with a note.'
  )
  process.exitCode = 1
}

// Set the exit code and return rather than calling process.exit() — forcing
// teardown while the Supabase client still holds an open socket trips a libuv
// assertion on Windows. Letting the event loop drain exits cleanly with the code.
main().catch((err) => {
  console.error('check-migration-drift: unexpected error:', err)
  process.exitCode = 2
})
