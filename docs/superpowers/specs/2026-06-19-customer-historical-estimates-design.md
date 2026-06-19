# Customer Historical Estimates — Design

**Date:** 2026-06-19
**Branch:** `feat/customer-historical-estimates` (off `origin/master`)
**Origin:** Grew out of feedback #53 ("what happens when I click handled on the declined estimates page?"). The question revealed a real gap: once an estimate is dealt with, there is no single place to see everything ever quoted to a customer. Feedback #53 itself is answered and needs no code; this is a separate feature.

## Goal

Add a **Historical Estimates** section to the customer profile page (`/customers/[id]`) that
serves as an **audit / record-keeping ledger**: a complete, read-only list of every estimate
ever given to that customer, with amount, outcome, and date.

## Scope decisions (confirmed with Caleb)

- **Purpose:** Audit / record-keeping. Completeness of the ledger matters most; actions are out of scope.
- **Granularity:** **Current estimate per ticket** — one row per service ticket showing its
  current/final estimate. Superseded quotes (from a re-quote that overwrote the live row) are
  **not** listed separately. Source of truth is `service_tickets` only — no `equipment_estimate_log`
  union, no dedupe.
- **What counts:** **Any ticket with an estimate amount** — `estimate_amount IS NOT NULL`,
  `deleted_at IS NULL`, regardless of current status (estimated, approved, in_progress, completed,
  billed, declined).
- **Placement:** A **collapsible section, collapsed by default**, with a count badge
  ("Historical Estimates (N)"). Lives in the existing vertical section stack on `/customers/[id]`,
  **after Equipment, before the audit History section**.
- **Row content:** Key columns + **link to the ticket** (`/service/[id]`).
- **Data loading:** **Eager** — fetched in the page's existing server component `Promise.all(...)`.

## Non-goals (YAGNI)

- No re-quote / reopen / call-back actions from this section (audit view, not a worklist).
- No superseded-quote history, no `equipment_estimate_log` integration.
- No new route, no new API endpoint, no schema/migration change.
- No filters, search, or CSV export in v1.
- No new permission model — inherits the page's existing gating.

## Architecture

Three pieces, all following existing patterns in the codebase.

### 1. Data layer — `src/lib/db/customer-estimates.ts` (new)

Modeled directly on `src/lib/db/declined-queue.ts` (the sibling pattern), but simpler — no
`users` join (we are not showing the technician).

```
export type CustomerEstimateRow = {
  id: string
  work_order_number: number | null
  equipment_label: string
  serial_number: string | null
  estimate_amount: number | null
  status: string
  decline_reason: string | null
  estimated_at: string | null
}

export async function getCustomerEstimates(customerId: number): Promise<CustomerEstimateRow[]>
```

Query against `service_tickets`:
- `.eq('customer_id', customerId)`
- `.not('estimate_amount', 'is', null)`
- `.is('deleted_at', null)`
- `.order('estimated_at', { ascending: false, nullsFirst: false })` (newest first; tickets without
  `estimated_at` sort last)
- Embed `equipment(make, model, serial_number)`; also select the denormalized
  `equipment_make/equipment_model/equipment_serial_number` columns as a fallback (mirrors how
  `declined-queue.ts` resolves the equipment label via `firstNonEmpty`).
- Select: `id, work_order_number, status, estimate_amount, decline_reason, estimated_at`.

`equipment_label` is derived the same way as `declined-queue.ts` (`firstNonEmpty([make, model]...)`,
falling back to `'Equipment'`).

### 2. Page wiring — `src/app/customers/[id]/page.tsx`

- Import `getCustomerEstimates`.
- Add it to the existing `Promise.all([...])` so it loads eagerly alongside `getCustomer`,
  `getEquipment`, and the labor rates.
- Render the new section after the Equipment card and before `<AuditHistorySection ... />`.

### 3. UI — collapsible section

- Use a native `<details>` element, **collapsed by default** (no `open` attribute). This matches
  the existing pattern (`AuditHistorySection` already uses `<details>/<summary>`), so **no new
  client component is required** — the section is fully server-rendered.
- `<summary>` renders the section header **"Historical Estimates (N)"** where N is the row count,
  styled to match the other section headers on the page.
- Expanded body is a table using the **same Tailwind classes as the existing Equipment / Contacts
  tables** on this page. Columns:
  | Column | Source | Notes |
  |---|---|---|
  | Date | `estimated_at` | formatted; `—` when null |
  | WO # | `work_order_number` | `—` when null |
  | Equipment | `equipment_label` + `serial_number` | serial as secondary text |
  | Amount | `estimate_amount` | currency format |
  | Status | `status` | colored badge (see below) |
  | Decline reason | `decline_reason` | only shown/populated for declined rows; `—` otherwise |
- Each row links to `/service/${id}` (reuse the `<Link>` pattern already used in the Equipment table).
- **Empty state:** "No estimates on file." (matches the page's existing empty-state copy/styling).
- **Status badge colors:** reuse the existing status-badge color scheme from
  `src/app/service/[id]/ServiceTicketDetail.tsx` (e.g. green=approved, red=declined) rather than
  inventing a new palette. If a shared helper exists, use it; otherwise mirror its mapping.

## Permissions

No new gating. `/customers/[id]/page.tsx` already calls `await requireRole(...MANAGER_ROLES)` at the
top, and estimate amounts already render for these roles elsewhere in the app. The section inherits
manager/coordinator visibility for free. (Note: this is slightly broader than the audit History
section, which is super_admin/manager only — but estimate amounts are already manager-visible, so
this is consistent with existing exposure.)

## Data flow

```
/customers/[id] page (server component, MANAGER_ROLES gated)
  └─ Promise.all([... , getCustomerEstimates(customerId)])
        └─ service_tickets WHERE customer_id = id
             AND estimate_amount IS NOT NULL AND deleted_at IS NULL
             ORDER BY estimated_at DESC NULLS LAST
             (+ embedded equipment)
  └─ <details> Historical Estimates (N)
        └─ table of rows, each linking to /service/[id]
```

## Error handling

- DB error: the query function throws (same as `declined-queue.ts`); the page already renders within
  the app's normal error boundary. No special handling needed.
- No estimates: render the empty state, badge shows "(0)".
- Null fields (`work_order_number`, `estimated_at`, `serial_number`): render `—`.

## Testing

- Unit test for `getCustomerEstimates` following the existing test pattern for sibling `src/lib/db`
  modules:
  - returns only tickets for the given `customer_id`
  - excludes tickets with `estimate_amount IS NULL`
  - excludes soft-deleted tickets (`deleted_at` set)
  - sorts newest-first with null `estimated_at` last
  - derives `equipment_label` from embedded equipment with denormalized fallback
- If the repo has no DB-layer unit test harness to model after, fall back to a focused test of the
  row-mapping/label-derivation logic and note the query is covered by manual verification.

## Verification (manual, before PR)

- Open a customer with multiple estimates → section shows correct count, collapsed by default.
- Expand → rows newest-first, amounts/outcomes correct, declined rows show reason.
- Click a row → lands on the right `/service/[id]`.
- Open a customer with no estimates → "(0)" + empty state.

## Files touched

- `src/lib/db/customer-estimates.ts` — new
- `src/app/customers/[id]/page.tsx` — add fetch + render section
- (possibly) a small presentational sub-component for the section if `page.tsx` grows unwieldy —
  decide during implementation; default is inline to match the other sections.
- test file for `getCustomerEstimates`
