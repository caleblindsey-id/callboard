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
needed a manual review to find. When you touch a bulk write on either
table, check it by hand; a passing test run is not evidence the write is
safe.

A manual review of these writes has itself proven fallible once already:
one sweep found and fixed five id-set writes across five routes, a second
sweep found and fixed a sixth, and both still missed two more
(`billing/service/mark-billed/route.ts`'s pickup-stage update and
`notify-assignment.ts`'s audit-stamp update, both several dozen lines below
a write already checked in the same file, and both trusting an id set
filtered a few lines earlier in the same request rather than carrying
their own guard). The pattern in both misses is the same: a file gets
marked "checked" after its first or most obvious `.update(` is fixed, and a
second write lower in the same file is never re-examined. The miss was
only caught by re-deriving the full list from scratch: grep every
`.in('id', ...)` in the repo (not just ones next to a `.update(` you
already noticed), then check the table for every single match, including
matches in files you have already touched. Do not treat a file as done
because one write in it is guarded.

Prefer `applyServiceTicketFilters()` in `src/lib/db/service-tickets.ts` for board
and count queries. It already handles the default-hide, deletedOnly, and
includeDeleted cases.

# Lint: react-hooks/set-state-in-effect

`npm run lint` gates CI on **errors** (warnings are reported, not fatal). Keep it
at zero errors.

Seven call sites carry a targeted
`eslint-disable-next-line react-hooks/set-state-in-effect`. They are all the same
shape: an effect that **resets derived state when its input changes**, before
kicking off a fetch. Do not remove them without reading this.

The rule wants the reset derived during render instead. In this codebase that
does not work, for two separate reasons:

1. **It changes the UX.** For the debounced search boxes, deriving the cleared
   view at render either flashes the previous query's results for the 300ms
   debounce window or closes the dropdown mid-typing. The synchronous clear is
   what avoids both. Same for the customer-to-ship-to and customer-to-equipment
   resets, where a stale selection from the previous customer must not survive
   even briefly, and where `CreateTicketModal`'s clear-then-filter-post-fetch
   order is load-bearing for draft restoration.
2. **It collides with another rule.** In `useOfflineQueue.ts` and
   `ReorderWalk.tsx` the render-time equivalent has to read a ref during render,
   which trips `react-hooks/refs`. There is no formulation that satisfies both.

So the rule stays **enabled** repo-wide, and every new violation is still an
error that fails CI. These seven are individually acknowledged rather than the
rule being downgraded, because a global downgrade would let future violations
through silently.

If you are adding new code and hit this rule, treat it as a real finding first.
Reach for a disable only when you can write down which of the two reasons above
applies to your case.
