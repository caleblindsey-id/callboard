# Equipment Estimate History (unified) — Design

**Date:** 2026-06-19
**Branch:** `feat/customer-historical-estimates` (off `origin/master`)
**Origin:** Grew out of feedback #53 ("what happens when I click handled on the declined estimates
page?"). The question exposed a real gap: there is no single, complete, broadly-visible place to see
every estimate ever quoted for a piece of equipment. Feedback #53 itself is answered and needs no code.

## Goal

Give **all roles** (managers, coordinators, super_admins, **and technicians**) a single, complete
**audit ledger of every estimate** ever given for a piece of equipment, on the equipment detail page
(`/equipment/[id]`), with amount, outcome, and date.

## How we got to "equipment-scoped, all roles, merged"

These were confirmed with Caleb in sequence:

1. **Purpose:** audit / record-keeping — completeness matters most, actions out of scope.
2. **Visibility:** all roles, including technicians.
3. The original "customer profile" placement is **dropped**: `/customers/[id]` is gated to
   managers/coordinators and also exposes sensitive billing/AR/labor-rate data, so it is *not* a home
   for an all-roles view. The equipment detail page (`/equipment/[id]`) **is** reachable by all roles
   (`requireRole(...MANAGER_ROLES, 'technician')`) and is already where estimate history lives.
4. The equipment page **already has** a "Past Estimates" section (`<EstimateHistory>`), but it is
   sourced only from `equipment_estimate_log`, which captures **declined** estimates as durable
   snapshots. It does not show approved/completed/billed estimates.
5. **Reconciliation:** **merge** both sources into one unified, deduped history (Caleb's choice) —
   the most complete answer to the audit goal.

## Scope decisions

- **Scope unit:** per **equipment** (not per customer).
- **Sources merged:**
  - `service_tickets` (live, current estimate per ticket) — every status, where an estimate exists.
  - `equipment_estimate_log` (migration 117) — durable **declined** snapshots that survive a re-quote.
- **What counts (service_tickets):** `equipment_id = X`, `estimate_amount IS NOT NULL`,
  `deleted_at IS NULL`, **any** status (estimated, approved, in_progress, completed, billed, declined,
  canceled).
- **What counts (log):** all `equipment_estimate_log` rows for the equipment.
- **Dedupe:** a log snapshot that merely restates a ticket's *current* declined estimate is hidden;
  a log snapshot that has been *superseded* (ticket re-quoted/approved, or ticket deleted) is kept as
  a distinct historical entry. (Rule below.)
- **Placement:** replaces the existing "Past Estimates" section on `/equipment/[id]` with a single
  "Estimate History" section (same slot, between Service History and Equipment Notes).
- **Row content:** date, WO #, outcome (colored badge), amount, what-it-was-for / decline reason.
  Links to `/service/[id]` when a ticket id is available.
- **Data loading:** eager, in the page's existing `Promise.all([...])`.

## Non-goals (YAGNI)

- No customer-profile section (dropped — see above; could be a future manager-only add).
- No actions (reopen / re-quote / call-back) from this view — audit, not a worklist.
- No new route, no new API endpoint, no schema/migration change.
- No filters/search/export in v1.
- No new permission model — inherits the equipment page's existing all-roles gating; both source
  tables are already all-roles readable on this page.

## Architecture

### 1. Data layer — `getEquipmentEstimateHistory(equipmentId)` (new, in `src/lib/db/equipment.ts`)

Queries both sources for the equipment, merges, dedupes, and returns a unified, date-sorted list.
Both queries are by `equipment_id`, which is **indexed** on both tables
(`idx_service_tickets_equipment`, `idx_equipment_estimate_log_equipment_created`).

Unified row type (new, in `src/types/`):

```
export type EquipmentEstimateHistoryRow = {
  key: string                       // `t:${ticketId}` | `l:${logId}` — stable React key
  source: 'ticket' | 'log'
  service_ticket_id: string | null  // link target for /service/[id]; null for orphaned log rows
  work_order_number: number | null
  estimate_amount: number | null
  outcome: string                   // ticket.status OR log.outcome (e.g. approved/declined/billed)
  decline_reason: string | null
  description: string | null        // problem_description
  date: string | null               // ticket.estimated_at OR log.created_at
}
```

**Query A (tickets):** `service_tickets` select
`id, work_order_number, estimate_amount, status, decline_reason, estimated_at, problem_description`
where `equipment_id = X`, `estimate_amount` not null, `deleted_at` is null.

**Query B (log):** existing `equipment_estimate_log` shape (reuse `getEquipmentEstimateLog`'s query or
inline it): `id, service_ticket_id, work_order_number, estimate_amount, outcome, decline_reason,
problem_description, created_at` where `equipment_id = X`.

**Dedupe rule (in JS):**
- Build a set of signatures for **currently-declined** tickets:
  `sig = `${ticket.id}|${cents(estimate_amount)}`` for every ticket row with `status = 'declined'`.
- A log row is a **duplicate** (skip it) iff: `log.service_ticket_id` is non-null AND
  `\`${log.service_ticket_id}|${cents(log.estimate_amount)}\`` is in that set — i.e. the log snapshot
  matches a ticket that is *still* declined at that same amount, so the ticket row already represents it.
- Otherwise **keep** the log row (superseded after re-quote, different amount, or `service_ticket_id`
  null because the ticket was deleted). `cents(x)` = `Math.round((x ?? 0) * 100)` to avoid float noise.
- Map all ticket rows + kept log rows into `EquipmentEstimateHistoryRow`, then sort by `date` desc,
  nulls last.

### 2. Component — `src/components/EstimateHistory.tsx` (modify)

- Change the prop type from `EquipmentEstimateLogRow[]` to `EquipmentEstimateHistoryRow[]`.
- Rename the heading from "Past Estimates" to **"Estimate History"**; keep the
  count, the collapsible behavior, and the mobile-card + desktop-table dual layout.
- Generalize `OutcomeBadge` to cover all outcomes (currently only special-cases `declined`):
  approved → green, declined → red, billed/completed → blue, estimated/in_progress → amber,
  canceled/other → gray. Reuse the status-color mapping from `ServiceTicketDetail` if a shared helper
  exists; otherwise mirror it.
- Link to `/service/${service_ticket_id}` when present (already the pattern); plain text otherwise.
- The empty case: render nothing (current behavior) OR a small "No estimates yet" — keep current
  "render nothing when empty" to match today's behavior.

### 3. Page wiring — `src/app/equipment/[id]/page.tsx` (modify)

- Replace `getEquipmentEstimateLog(id)` in the `Promise.all([...])` with
  `getEquipmentEstimateHistory(id)`.
- Pass the unified rows to `<EstimateHistory items={...} />`. No other change to the page.

## Visibility / permissions

- The equipment page is already `requireRole(...MANAGER_ROLES, 'technician')` — all roles.
- Both source tables are already read on this page for all roles
  (`getServiceTicketsForEquipment`, `getEquipmentEstimateLog`), and `equipment_estimate_log` RLS is
  `TO authenticated USING (true)`. No RLS change needed.
- **Estimate amounts are shown to technicians** — consistent with today's `EstimateHistory`, which
  already shows `estimate_amount` to all roles. (This differs from `ServiceHistory`, which gates
  *billing* amounts via `showBilling`; estimate amounts are intentionally not gated here, matching
  existing behavior and Caleb's all-roles intent.)

## Data flow

```
/equipment/[id] (server component, all roles)
  └─ Promise.all([... , getEquipmentEstimateHistory(id)])
        ├─ service_tickets WHERE equipment_id = id
        │     AND estimate_amount IS NOT NULL AND deleted_at IS NULL   (any status)
        ├─ equipment_estimate_log WHERE equipment_id = id
        └─ merge + dedupe (hide log snapshots that restate a still-declined ticket)
             → rows sorted by date desc
  └─ <EstimateHistory items={rows} />  (unified badges, links to /service/[id])
```

## Edge cases & error handling

- DB error in either query: throw (same as siblings); page renders within the app error boundary.
- Ticket with `estimate_amount` but null `estimated_at` (e.g. estimate set before migration 114
  stamped the timestamp): still listed; sorts to the bottom; date renders `—`.
- Log row with null `service_ticket_id` (ticket deleted): kept, shown without a link.
- Same ticket re-quoted multiple times: each *superseded* declined snapshot in the log shows as its
  own historical row; the live ticket shows its current estimate once.
- A completed/billed ticket appears both here (as its estimate) and in Service History (as work).
  That's intentional — different lenses (the quote vs. the work). Noted so it isn't mistaken for a bug.

## Testing

Unit tests for `getEquipmentEstimateHistory` (or the pure merge/dedupe helper, factored out so it can
be tested without a DB), following the existing `src/lib/db` test pattern:
- includes every ticket with an estimate amount, excludes null-estimate and soft-deleted tickets
- includes log snapshots
- **dedupe:** a still-declined ticket + its matching log snapshot → one row (the ticket)
- **dedupe:** a re-quoted ticket (now approved) + its old declined log snapshot → two rows
- log row with null `service_ticket_id` → kept, no link
- sorted by date desc, null dates last
- outcome → badge color mapping

## Manual verification (before PR)

- As a **technician**, open an equipment page → Estimate History visible, with amounts.
- Equipment with a declined-then-re-quoted ticket → both the old declined quote and the new estimate
  appear; the live declined ones aren't doubled.
- Rows link to the correct `/service/[id]`.
- Equipment with no estimates → section behaves as today (renders nothing / empty).

## Files touched

- `src/lib/db/equipment.ts` — add `getEquipmentEstimateHistory` (+ exported pure merge helper).
- `src/types/` — add `EquipmentEstimateHistoryRow`.
- `src/components/EstimateHistory.tsx` — accept unified rows, rename heading, generalize badge.
- `src/app/equipment/[id]/page.tsx` — swap the fetch + pass unified rows.
- test file for the merge/dedupe logic.
