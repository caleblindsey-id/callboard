# Approved-queue readiness

**Date:** 2026-07-28
**Origin:** Feedback #79 — Tamara Ridlehoover (manager), `/service`, 2026-07-20: *"too many on approved page, takes too much time seeing which ones go"*
**Branch:** `feedback/79-tamara-finds-the-approved-queue`

## Problem

The **Approved** tab on `/service` is the dispatch queue: the estimate is signed off, the work now has to go out. Deciding what to send means answering one question per ticket — *can this actually be started?*

The board cannot answer it. The Approved tab renders the generic table (WO#, status, priority, customer, location, equipment, type, tech, created) and **nothing on the row says whether the ticket is startable**. The manager opens tickets one at a time to find out. That is the whole of the complaint: not a bug, a triage cost that scales with the queue.

The app knows the answer already. `NextStepBar.tsx:200` renders **Start Work** only when `!partsBlocking`, and the detail page prints *"Waiting on parts (N of M still pending)"* (`ServiceTicketDetail.tsx:179`). The information exists one click away from every row that needs it.

### Size of it

Measured against **production**, 2026-07-28. Note for anyone re-running these: production is the Supabase project named *"Scheduler Program"* (`haohkybnmnpuxpiykjvb`) — the name is legacy, and it is what `.env.local` points at. The project named `callboard-dev` is a snapshot frozen on 2026-06-23 with no activity since; an earlier draft of this spec measured against it and got materially different numbers.

| Approved tickets (not deleted) | 22 |
|---|---|
| Have live pending parts — Start Work is hidden | **11** |
| Startable | 11 |
| Carrying an open credit review | 0 |
| Average age | 31 days (oldest 174) |

**Half the queue is not actionable, and the board gives no signal which half.**

### Why the existing control does not cover it

A `Waiting on Parts` checkbox already exists in the FilterBar. It fails this use case twice over:

1. **It is one-way.** It shows the *blocked* tickets. Tamara wants the complement — the ones she can send.
2. **It is inaccurate, latently.** It keys off the `parts_received` column, and **22 tickets in prod carry a wrong value** — every live part `cancelled` or `from_stock`, yet still flagged as waiting. None of those 22 are sitting in `approved` today, so the filter is not actively misreporting the Approved tab; the wrongness is one status transition away, and the derivation that produces it is still live in the codebase. (In the stale `callboard-dev` snapshot, 4 of 34 approved rows *were* affected — which is how this surfaced.)

That inaccuracy is a symptom of a deeper split. "Are this ticket's parts in?" is currently computed **three different ways**:

| Site | `from_stock` counts as fulfilled? |
|---|---|
| `lib/parts.ts` `partsOnOrder()` — the detail page | **Yes** |
| `api/parts-queue/update/route.ts:493-497` | **Yes** |
| `api/service-tickets/[id]/route.ts:985` | **No** ← drift |
| `lib/db/service-tickets.ts:59-61` — the board filter | reads the column, so inherits whichever wrote last |

A readiness signal built on top of this without fixing it would inherit the disagreement.

## Approaches rejected

**Derive per-request from `parts_requested`, no schema work.** The list route pulls the JSONB, computes a pending count, strips the blob before responding. Always correct, no backfill. Rejected because the derived value cannot be a *server-side* filter predicate: `Ready to start` would only narrow rows already loaded, silently capping at the 100-row page. On a queue the user describes as "too many", a filter that quietly covers only the first page is worse than no filter.

**Chip with no filter.** Smallest possible change. Rejected — it leaves the manager scanning a long list by eye, which is the cost being complained about.

**Credit state in the `ready` filter predicate.** Considered and dropped; see "Credit is a chip, not a predicate" below.

**Generated column / trigger for a pending-parts count.** More machinery than the problem needs. The aligned boolean plus a per-page aggregate covers it without new schema surface to keep in sync.

## Design

### 1. One rule for "nothing outstanding"

Add to `src/lib/parts.ts`, beside the existing `partsOnOrder()`:

```
partsAllFulfilled(parts):
  live = parts.filter(p => !p.cancelled)
  return live.every(p => p.status === 'received' || p.status === 'from_stock')
```

Vacuously true when nothing is live — which is the point. It resolves both drift cases in one definition: `from_stock` is fulfilled in-house (already the rule everywhere except one route), and an all-cancelled ticket stops being stuck at `parts_received = false` forever.

Both write paths call it: `api/service-tickets/[id]/route.ts:985` and `api/parts-queue/update/route.ts:493-497`.

**Blast radius.** A repo-wide grep puts `parts_received` at exactly three consumers — the two derivations above and the board filter. The RPCs in migrations 074 and 145 only pass the value through (`WHEN p_update_payload ? 'parts_received' THEN ... ELSE parts_received`); nothing computes it in SQL.

### 2. Migration 146 — backfill

Existing rows were written under the old rules, so the code fix alone leaves them wrong. `146_backfill_parts_received.sql` sets `parts_received = true` wherever no live pending part remains. It skips empty `parts_requested` (see §3), includes soft-deleted rows (deletion is reversible; a restored ticket should come back correct), and is idempotent.

Scope: **22 rows in prod**, 11 in the dev snapshot.

**Ordering is load-bearing.** The backfill must land *after* the §1 code alignment, not before. `api/service-tickets/[id]/route.ts:985` still excludes `from_stock`, so while it is live, the next parts PATCH on a backfilled ticket rewrites the column back to `false`. Backfilling first produces a fix that quietly decays.

Per AGENTS.md there is no CI step that applies migrations. Status: **applied to `callboard-dev` 2026-07-28** (recorded as `146_backfill_parts_received`; verified 0 remaining drift, 0 inverse drift, 0 part-less rows flipped). **Not yet applied to prod** — that waits on the code change shipping, then `npm run check:migrations` to confirm no drift.

### 3. Filter predicates

The **waiting** predicate does not change. The alignment and backfill are what make it accurate; `ready` is its exact complement:

```
waiting:  parts_received = false AND parts_requested <> '[]'
ready:    parts_received = true  OR  parts_requested  = '[]'
```

Keeping the `parts_requested <> '[]'` clause — rather than flipping the column default to `true` — is deliberate. A brand-new ticket with no parts never runs the derivation, so it sits at the `false` default; without that clause it would be mislabeled "waiting on parts" from birth.

`ready` is wired into **`applyServiceTicketFilters()`** in `lib/db/service-tickets.ts`, not into the caller. That function exists precisely to stop the list query and the tab counts from drifting apart, and a predicate added anywhere else defeats it.

### 4. Per-row counts without the blob

The chip says `Parts 2 of 3`, which the boolean alone cannot supply, and the list select deliberately omits `parts_requested` to keep large JSONB off the wire.

The counts come from a single aggregate over the **`parts_order_queue`** view for the ticket ids on the current page — one indexed query, no blob.

The view carries its own status gate (migration 055 restricts it to approved-and-later tickets), so it is only a valid source on the tabs where the chip renders — and the chip renders on exactly those two stages. Verified against both databases: the view's pending count and the JSONB derivation agree on **32/32** approved + in-progress rows in prod, and **39/39** in the dev snapshot.

Across all statuses the view under-reports (18 vs 21 tickets-with-pending-parts in dev) precisely because of that status gate. That is the reason the chip is scoped to Approved and In Progress rather than being generalized to every tab.

### 5. Credit is a chip, not a predicate

Credit review is a genuine work gate — the detail page says *"Work is gated until AR releases it"* (`ServiceTicketDetail.tsx:2360`) — and `credit_reviews ( status )` is already in the board's select, already rendering a `CreditReviewBadge` on the mobile card (`ServiceTicketBoard.tsx:588`) and desktop cell (`:695`).

It is **not** in the `ready` predicate. Three reasons:

1. **Not expressible server-side.** "Has no open credit review" is an anti-join against a child table. PostgREST cannot do it: a non-inner embed nulls the embed but still returns the parent row — the same constraint that forced `customers!inner` on the `poNeeded` path (`lib/db/service-tickets.ts:79-82`). Including it would mean dropping rows client-side, which re-introduces the page-1 cap that killed the derive-per-request approach and makes the `Showing N of M` footer under-count.
2. **It would make the board contradict the detail page.** `viewerHasPrimaryAction` (`ServiceTicketDetail.tsx:2054`) gates Start Work on parts *alone*. A credit-blocked approved ticket renders the button today. A board claiming "not ready" about a ticket whose detail page offers Start Work is a worse failure than the one being fixed.
3. **Zero affected rows** — no approved ticket in prod (or in the dev snapshot) currently carries an open credit review.

Credit instead makes the **chip** credit-aware — pure render, zero query cost, since the data is already on the row. An approved row with an open credit review shows its credit state rather than a green `Ready`, so the board never displays "Ready" beside a red "Credit blocked" badge.

**Residual, accepted:** a credit-blocked ticket can appear under `Ready to start`. It arrives visibly carrying its credit chip and badge, so it is self-evident rather than a trap.

### 6. Board UI

**Readiness chip** — Approved and In Progress rows, desktop cell and mobile card. First match wins, so a ticket blocked on both parts and credit shows the parts chip (the parts blocker is the one the row cannot otherwise reveal; credit already has its own badge alongside):

| State | Chip |
|---|---|
| Live parts pending | amber `Parts 2 of 3` — the detail page's wording (`ServiceTicketDetail.tsx:179`) |
| Open credit review | credit state, not `Ready` |
| Otherwise, Approved | green `Ready` |
| Otherwise, In Progress | *(none)* |

In Progress gets the amber chip only. A "Ready" chip on work already underway is noise; a *stalled* tech mid-job is the signal worth surfacing.

**Segmented filter** replaces the one-way checkbox: `All · Ready to start · Waiting on parts`, writing `ready=1` / `waitingOnParts=1` to the URL as mutually exclusive states. The existing `waitingOnParts=1` dashboard deep-links keep working unchanged.

**Sorting.** Readiness becomes a sortable column. The default sort is **not** changed — silently reordering a board people have learned costs more than it saves, and one click on `Ready to start` is the actual answer to the complaint.

## Testing

- Unit tests for `partsAllFulfilled`: `from_stock`, all-cancelled, empty, mixed, all-received.
- A test pinning both write paths to the same result for the same input, so the drift cannot silently return.
- Filter-predicate tests for `ready` / `waiting` as complements, including the no-parts-yet case that motivated keeping the `<> '[]'` clause.

Soft-delete note: the new `parts_order_queue` aggregate is scoped to ticket ids that came from an already-guarded list query. It is not a `service_tickets` read, so `npm test`'s guard will not flag it either way — per AGENTS.md that means it needs the human read, which is this paragraph.

## Verification

This worktree has no `node_modules`, so typecheck and lint are scoped to touched files and real behavior is confirmed on the Vercel preview rather than a local dev server.

## Out of scope

The detail page tells the viewer *"Work is gated until AR releases it"* (`ServiceTicketDetail.tsx:2360`) while leaving **Start Work** fully clickable — `viewerHasPrimaryAction` (`:2054`) never consults credit state. Either the banner overstates the gate or the button under-enforces it. Pre-existing, unrelated to #79, and noted here so the decision in §5 is not mistaken for an endorsement of it. Worth its own feedback item.
