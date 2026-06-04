<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database migrations are applied manually

There is **no CI step that applies migrations**. Adding a file under `supabase/migrations/` does **not** put it in any database — someone must apply it out-of-band (Supabase SQL editor / MCP / CLI). This has already bitten us: migration `073_tech_leads_structured_equipment` was merged but never applied to prod, so the deployed API wrote columns (`make`, `model`, `serial_number`, …) that didn't exist and **every** tech-lead submission returned a 500 (feedback #21).

When you add a migration, apply it to the target database in the same change, and after deploying confirm there's no drift:

```
npm run check:migrations
```

This compares `supabase/migrations/*.sql` against the database's applied set (via the `public.applied_migrations` RPC, migration 092) and fails loudly on any repo migration that was never applied. Note: the recorded migration **names** diverge from the repo `NNN_` filenames, and the baseline migrations (001–006) predate tracking — reconcile by **effect**, not by number. Known-divergent/baseline files are allowlisted in `scripts/check-migration-drift.mjs`.
