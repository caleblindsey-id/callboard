# Soft-delete query guard

**Date:** 2026-07-27
**Origin:** Tracing the dashboard "Open Work" card surfaced a live data bug (PR #256, commit `2bbf1e9`).
**Branch:** `feat/soft-delete-query-guard`

## Problem

`service_tickets.deleted_at` and `pm_tickets.deleted_at` are soft deletes. A deleted ticket **keeps its pre-delete status**, so a ticket deleted while `open` matches `status IN ('open','estimated','approved','in_progress')` forever. Every read that aggregates or lists must add `.is('deleted_at', null)` by hand.

On 2026-07-27 that hand-written guard was missing from all nine `service_tickets` reads in `src/lib/db/dashboard-metrics.ts`, plus three more sites. The Open Work card read **Svc 161** against a true **64**. Ready to Bill was overstated by $2,710.23 and Pending Approval by $2,320.00, both money paths feeding the billing queue.

Two structural facts make this recur:

1. **RLS does not filter deleted rows.** The `service_tickets_select` policy scopes by role only, with no `deleted_at` predicate (verified against `pg_policy`). Soft-deleted rows reach any staff session.
2. **There are 182 call sites** (108 `service_tickets`, 74 `pm_tickets`) and nothing marks a new one as wrong. PR #256 fixed the known instances but added no pressure against the next omission.

Current exposure: 97 service tickets and 57 PM tickets are soft-deleted while still carrying an open status.

## Approaches rejected

**RLS predicate.** Architecturally cannot work. The manager "Deleted" board must read deleted tickets, so the policy would need a manager exception, which leaves managers with inflated counts while coordinators get correct ones. RLS filters by row and role; it cannot distinguish "this manager query is the Deleted board" from "this manager query is the Open Work card." A per-request session GUC could bridge it but is fragile through Supabase's connection pooler.

**`service_tickets_active` view.** Avoids the RLS problem but requires migrating 182 call sites, nearly all of which use PostgREST embeds (`customers(name)`, `equipment(...)`). Embed resolution through a view depends on PostgREST inferring FKs from the underlying table: usually fine for a trivial view, but a failure on one query in twenty would surface in prod. Deferred, not discarded. See "Revisit trigger" below.

**Typed query helper alone.** Makes the correct call easy but nothing forces its use, so coverage decays.

## Design

### 1. AST-based checker

A regex sweep is not viable. The exploratory grep run on 2026-07-27 flagged 55 sites of which only 6 were real, because it broke on multi-line template selects and could not see delegation to `applyServiceTicketFilters`. A guard with that false-positive rate gets disabled.

The checker walks the TypeScript AST using the `typescript` package (already a devDependency, no new packages). It locates each `.from('service_tickets')` / `.from('pm_tickets')` call and walks the fluent chain as an expression tree, which makes multi-line selects and template literals structurally irrelevant.

### 2. The rule

A call site must carry `.is('deleted_at', null)` unless it is **mechanically** exempt:

| Exempt because | Detected by |
|---|---|
| It is a write | `.insert` / `.update` / `.upsert` / `.delete` in the chain |
| It reads one row by primary key | `.eq('id', ...)` in the chain |
| It reads one row | `.single()` / `.maybeSingle()` terminal |
| It delegates to the shared filter helper | query expression passed to `applyServiceTicketFilters(...)` |

Everything else is a multi-row read and requires the guard.

The helper exemption is load-bearing: `applyServiceTicketFilters()` in `src/lib/db/service-tickets.ts` already handles all three soft-delete cases (default hide, `deletedOnly`, `includeDeleted`), and every query routed through it was correct. Queries written outside it are where the bug lives.

### 3. Allowlist for judgment calls

Remaining exceptions are judgment, not pattern. Audit-trail resolution should outlive deletion. The billing routes act on an `.in('id', ids)` set already sourced from a guarded board list, which is only safe because of where the ids came from, and an AST cannot know that.

> **Superseded during implementation (Task 4 fix round 1, 2026-07-28).** The
> "already sourced from a guarded board list" reasoning quoted above and in
> the example below was tried as the allowlist rationale for
> `mark-billed`/`unexport` on both PM and service tickets, then rejected on
> review: it only covers the read layer. The routes' own fetch and CAS
> update never checked `deleted_at`, and soft-delete does not clear
> `status`/`billing_exported`, so a stale tab or a crafted request bypassing
> the board entirely could still bill or un-export a soft-deleted ticket.
> The fix was to add the guard to the routes (both the fetch and the write),
> not to document the upstream-source argument as sufficient. Do not
> re-adopt this reasoning for a new route; check the route's own query, not
> where its caller says the ids came from. See
> `src/app/api/billing/mark-billed/route.ts`,
> `src/app/api/billing/unexport/route.ts`, and their three service-ticket
> siblings for the corrected shape, plus `src/app/api/billing/pdf/route.ts`
> (fixed one round later, PM export's CAS write) for the same pattern one
> more time.

These go in an explicit allowlist keyed by file path and symbol, with a **required** reason string:

```ts
// src/lib/db/__guards__/soft-delete-allowlist.ts
{ file: 'src/lib/db/auditEvents.ts', symbol: 'resolveTicketIdsByWorkOrder',
  reason: 'Audit history must survive deletion; a deleted ticket still shows its trail.' },
{ file: 'src/app/api/billing/service/mark-billed/route.ts', symbol: 'POST',
  reason: 'Acts on an explicit id set posted from the billing board, which is already guarded.' },
```

> **Superseded during implementation.** The allowlist as built lives at
> `src/lib/soft-delete-allowlist.ts` (not under a `src/lib/db/__guards__/`
> directory) and is keyed by **file path and line number**, not file path
> and symbol. Line numbers were cheaper for the checker to produce and
> compare than resolving an enclosing symbol name, at the cost of the
> allowlist needing a line-number bump whenever code above an entry shifts.
> The required-reason rule and the "judgment, not pattern" intent described
> above are unchanged; only the key shape differs from what is shown here.

An entry with an empty or missing reason fails the test. This makes the allowlist the documentation for a distinction that otherwise exists only in a chat transcript, and makes each future exception a deliberate reviewable act rather than a silent omission.

The failure message names file, line, and the exact missing clause, and states how to allowlist the site if the omission is intentional.

### 4. Test placement

The check ships as a normal test file so it rides the existing `node --import tsx --test` setup with no new runner.

**Verify before writing:** the `test` script globs `src/**/*.test.ts` and every existing test sits flat in `src/lib/`. Depending on shell globstar behavior that pattern may not reach a nested directory. Confirm whether a nested test is picked up; if not, either place the test flat alongside the others or fix the glob. Do not assume.

### 5. Pre-push hook

Pre-push, not pre-commit. Parsing 182 sites is fast but not instant, and a pre-commit hook firing on every WIP commit produces `--no-verify` as muscle memory. Pre-push catches the problem at the last moment before it leaves the machine.

Installation adds no dependency: commit `.githooks/pre-push`, and add a `prepare` script running `git config core.hooksPath .githooks` so it self-installs on `npm install`. Works identically on Mac and Windows.

## Rounds

**Round 1: checker, green on service tickets.** Build the AST walker and test, seed the allowlist with the known judgment exceptions, confirm it passes on current master. Deliverable: `npm test` fails on a new unguarded service-ticket read.

**Round 2: PM sweep.** Unknown scope by design. `service_tickets` was audited thoroughly; the 74 `pm_tickets` sites were only spot-checked, and 57 PM tickets are deleted-but-open right now. Fix whatever the checker surfaces. Could be zero findings; could be another `dashboard-metrics`.

**Round 3: hook and docs.** Wire the pre-push hook. Add a short rule to CLAUDE.md so the next agent reads it before writing a query rather than after.

## Out of scope

**The 154 deleted-but-open rows stay as they are.** Once the guard holds, their stale statuses are inert. Rewriting status on delete would cost restore fidelity for no gain. A separate decision, not this one.

**The `service_tickets_active` view.** Deferred per above.

## Revisit trigger

If Round 2 surfaces substantial PM damage, that is evidence the code-level approach does not hold on its own, and the view is worth reopening with better information than exists today.

## Success criteria

1. An unguarded multi-row read added to any file under `src/` fails `npm test` with a message naming file and line.
2. The checker reports zero false positives on current master. Every flagged site is either a real omission or carries an allowlist entry with a reason.
3. `git push` from a clean clone runs the check without manual hook setup beyond `npm install`.
4. Round 2 findings are fixed and verified against prod data the same way PR #256 was: before and after counts stated, not adjectives.

## Related

- PR #256 / commit `2bbf1e9`: the fix this guard protects.
- `wiki/feedback/feedback_callboard-soft-delete-guard.md` (Compass): the rule and the asymmetry tell that finds these.
- `wiki/feedback/feedback_parts-order-queue-view-leaks-closed.md` (Compass): why a second definition in a view drifted from the count functions, informing the view deferral.
- `wiki/feedback/feedback_callboard-pm-service-parity.md` (Compass): PM-first build order is why these guards drift apart between the two ticket types.
