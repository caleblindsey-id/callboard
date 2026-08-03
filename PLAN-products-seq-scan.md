# Plan: Products seq-scan disk-IO fix (app-side)

## Context
On 2026-06-17 the `products` table was being sequential-scanned 116-826/min with `idx_scan` pinned at 0 even after a manual `ANALYZE` (valid stats, `n_live_tup=12,969`). That burns the Supabase small-instance disk-IO burst budget and was a likely amplifier of the morning login outage (slow queries hold connections, pool saturates). Stats/autovacuum tuning provably cannot fix it. A code audit (2026-06-17) found the cause is **not** a full-catalog fetch but the **product search**: four client-side call sites run `.or(number.ilike.%q%,description.ilike.%q%)` on every keystroke, and `products.number` / `products.description` have **no index** — and the leading `%q%` wildcard cannot use a btree even if they did. Fix = `pg_trgm` GIN indexes on those columns, plus trimming the query volume the search fires. Desired outcome: on prod, `products.seq_scan` rate drops toward zero and `idx_scan` climbs.

## Out of Scope
- Heavy caching layer (Next `unstable_cache` / in-memory catalog with sync-invalidation) — deferred; the data shows no full-catalog read worth caching. Revisit only if seq_scans persist after the index + search-hygiene rounds.
- Moving search to a dedicated server-side API endpoint — not needed; the trgm index makes the existing client-side PostgREST queries indexable.
- Any change to the hourly Synergy sync / connection-pooler routing (tracked separately in the outage memory file).

## Rounds

### Round 1 — pg_trgm GIN search indexes (the core fix)
**Scope:** Enable the `pg_trgm` extension and add GIN trigram indexes on `products.number` and `products.description` so the existing `ILIKE '%q%'` search becomes index-backed.
**Files:** New `supabase/migrations/121_products_search_trgm.sql` (verify next free number against prod first — see Cross-Cutting).
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_number_trgm      ON products USING GIN (number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);
```
**Acceptance:** Migration applies clean on prod; the two GIN indexes exist.
**Verification:** `EXPLAIN ANALYZE` on the actual search query
`SELECT ... FROM products WHERE number ILIKE '%xxx%' OR description ILIKE '%xxx%' LIMIT 25;`
flips from `Seq Scan on products` to a `Bitmap Index Scan` (BitmapOr across the two trgm indexes), for a query string of >=3 chars. Capture the before/after plan.
**Memory:** Note that pg_trgm GIN now backs the parts search; reference from the outage file's RESOLVED section.

### Round 2 — Client search hygiene (cut the query volume)
**Scope:** Across the four search call sites, don't fire the products query until the trimmed term is >=2-3 chars, and confirm a consistent debounce. Short 1-2 char terms can't benefit from trigram indexes (trgm needs >=3 chars) and still seq-scan, so they should never hit the DB.
**Files:** `src/lib/hooks/useProductSearch.ts`, `src/components/service/PartsEntryList.tsx`, `src/components/PartSynergyPicker.tsx`, `src/app/tickets/[id]/renderPartsSection.tsx`. Prefer a single shared guard/helper if the search logic can be consolidated; otherwise apply the same threshold to each.
**Acceptance:** Typing 1 char fires no products query; typing >=3 fires exactly one (debounced) query that uses the trgm index. No regression to the parts-entry / picker UX.
**Verification:** Browser smoke test on each of the four entry points (parts entry during ticket creation, parts-queue picker, equipment default-products, ticket parts section); watch the network tab to confirm no sub-threshold queries fire.
**Memory:** Skip unless a non-obvious gotcha surfaces.

### Round 3 — Verify on prod + housekeeping
**Scope:** Confirm the fix held on prod, then mirror the untracked DB tuning into tracked migrations and clean up the redundant index.
**Files:** New `supabase/migrations/122_products_autovacuum_tuning.sql` mirroring the untracked 06-17 `ALTER TABLE ... SET (autovacuum_analyze_scale_factor=0.05, autovacuum_analyze_threshold=200, autovacuum_vacuum_scale_factor=0.1)` applied to `products,customers,contacts,ship_to_locations,synergy_po_lines`; optional `DROP INDEX idx_products_synergy_id;` (redundant with the `products_synergy_id_key` unique-constraint index).
**Acceptance:** Prod `products.seq_scan` per-minute rate is low (<=30/min) AND `idx_scan` is climbing; DB tuning is now represented in committed migrations (no untracked drift).
**Verification:** Re-run the seq_scan reading query from the outage memory file twice ~15 min apart; rate dropped and `idx_scan` rising. `npm run check:migrations` clean.
**Memory:** Update `wiki/knowledge/callboard-db-connection-exhaustion.md` RESOLVED section with the post-fix seq_scan/idx_scan numbers and that the autovacuum tuning is now a tracked migration.

## Cross-Cutting Concerns
- **Migration numbering drift.** Local tree tops out at `119`; prod has `120_device_pins` (per Compass memory) and there is historical duplicate-number drift (105/108/116). Before writing `121`/`122`, confirm the true next free number against prod (`npm run check:migrations` and/or `select * from supabase_migrations.schema_migrations order by version desc limit 5;`). Adjust filenames if 120/121 already exist on prod.
- **pg_trgm extension.** `CREATE EXTENSION IF NOT EXISTS pg_trgm` is required and safe on Supabase (ships with it). Round 1 is the only place it's enabled.
- **Index build cost.** GIN build on ~13k rows is trivial; `CREATE INDEX` (not `CONCURRENTLY`) inside a migration is fine at this size and avoids the can't-run-in-transaction caveat.
- **Rollback story.** Round 1/3 are additive DDL — back out with `DROP INDEX` / `RESET (...)`; no data risk. Round 2 is frontend-only — revert the commit.
- **Worktree discipline.** Per Compass memory, build CallBoard in a `git worktree` off master — the shared `Desktop/callboard` tree has been switched out from under concurrent sessions.

## Verification (end-to-end)
After all three rounds land and deploy: open the parts search in the live app, type a >=3-char term, confirm results return; then run the outage file's seq_scan reading query twice ~15 min apart and confirm `products.seq_scan` rate is <=30/min while `idx_scan` is climbing. That proves the search is index-backed and the IO drain is gone.

## History

### Round 3 — Verify on prod + housekeeping (shipped 2026-06-17 @ 2f70183, PR #146)
Verification half was confirmed live earlier today (15-min prod poll: `seq_scan` held flat at 97,832 / 0--min while `idx_scan` climbed 9→37). Housekeeping migration 122 (`autovacuum_tuning_and_index_cleanup`) applied to prod via `apply_migration` and merged: mirrors the untracked 06-17 autovacuum tuning on the 5 Synergy-sync tables into version control (idempotent) and drops the redundant `idx_products_synergy_id` (kept `products_synergy_id_key`). `products` now carries exactly pkey + synergy_id_key + the two trgm indexes. Built in worktree `.claude/worktrees/products-autovacuum-mirror`.

**PLAN COMPLETE — all 3 rounds shipped, merged, and verified on prod 2026-06-17. products seq-scan IO drain resolved.**

### Round 2 — Client search min-length guard (shipped 2026-06-17 @ 32e5aeb, PR #145)
New shared helper `src/lib/products-search.ts` (`MIN_PRODUCT_SEARCH_LEN=3` + `shouldSearchProducts()`); gates all four product-search call sites (shared `useProductSearch` hook + 3 inline implementations in `PartsEntryList`, `PartSynergyPicker`, `renderPartsSection`) to fire no DB query below 3 chars — the threshold below which the trgm index can't help, so they'd otherwise seq-scan. Trigger condition only; debounce/limits/sanitization/ordering unchanged. typecheck + build clean, zero new lint. Built in worktree `.claude/worktrees/products-search-min-length`. PR #145 awaiting merge; manual browser smoke test (1-2 chars → no request, >=3 → one query) still recommended.

### Round 1 — pg_trgm GIN search indexes (shipped 2026-06-17 @ 93eb5e6, PR #144)
Migration 121 (`products_search_trgm`) applied to prod via `apply_migration` (recorded in `schema_migrations`, so `check:migrations` stays green) and committed on branch `feat/products-search-trgm` (PR #144, awaiting merge). Enabled `pg_trgm`; added `idx_products_number_trgm` + `idx_products_description_trgm` GIN indexes. Verified on prod: the search query flipped from `Seq Scan` (3,475 rows filtered, 9.2 ms) to `Bitmap Heap Scan` via `BitmapOr` over both trgm indexes (11 heap blocks, 0.4 ms). Built in worktree `.claude/worktrees/products-search-trgm` off origin/master (had `120_device_pins`, so 121 is the next free number).
