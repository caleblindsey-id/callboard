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

# Soft-deleted tickets

`service_tickets.deleted_at` and `pm_tickets.deleted_at` are soft deletes, and a
deleted ticket keeps its pre-delete status. RLS does NOT filter deleted rows: the
select policies scope by role only. So every multi-row read that counts, sums, or
lists needs `.is('deleted_at', null)` or it silently inflates.

`npm test` enforces this for direct multi-row `.select()` reads on `pm_tickets`
and `service_tickets`. If a read is deliberately unguarded (a by-id lookup, a
write, audit-trail resolution), add an entry with a reason to
`src/lib/soft-delete-allowlist.ts`.

**What the guard does NOT cover, so these need a human read, not a green test
run:** embedded joins, for example `.from('ace_labor_entries').select('...,
service_tickets(...)')`, where the ticket data arrives nested inside another
table's row and the checker never sees a `pm_tickets`/`service_tickets`
`.from()` chain to flag; anything read through `.rpc()`; and, most
importantly, **write paths are exempt by design.** An `.update(...).in('id',
...)` chain on `pm_tickets` or `service_tickets` is never a scanner finding,
guarded or not, because the checker only flags reads. That is why
`src/app/api/billing/pdf/route.ts`'s CAS write carried no `deleted_at` or
`status` guard for two review rounds after the read on the same route was
already fixed: the write was invisible to `npm test` the whole time and
needed a manual grep for `.update(` chains on these two tables to find. When
you touch a bulk write on either table, check it by hand; a passing test run
is not evidence the write is safe.

Prefer `applyServiceTicketFilters()` in `src/lib/db/service-tickets.ts` for board
and count queries. It already handles the default-hide, deletedOnly, and
includeDeleted cases.
