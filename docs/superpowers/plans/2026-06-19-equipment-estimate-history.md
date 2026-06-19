# Equipment Estimate History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the declined-only "Past Estimates" section on `/equipment/[id]` with a single all-roles "Estimate History" that merges live `service_tickets` estimates (any outcome) with durable `equipment_estimate_log` declined snapshots into one deduped, date-sorted ledger.

**Architecture:** A pure, dependency-free merge/dedupe helper (`src/lib/db/estimate-history.ts`) is unit-tested in isolation. An async fetcher in `src/lib/db/equipment.ts` runs the two indexed `equipment_id` queries and feeds the helper. The existing `EstimateHistory` component is generalized to render the unified row type; the equipment page swaps one fetch call.

**Tech Stack:** Next.js (App Router, server components), Supabase JS client, TypeScript, Tailwind. Tests via Node's built-in runner (`node --import tsx --test`), `node:test` + `node:assert/strict`.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code if unsure — this fork has breaking changes (per AGENTS.md). This plan touches no new Next APIs.
- No database migration: this feature is read-only over existing tables (`service_tickets`, `equipment_estimate_log`). Do **not** add a migration.
- All roles (incl. technicians) must see this section, including estimate amounts — consistent with today's `EstimateHistory`. Do not add a role/billing gate.
- Test command: `npm test` runs `node --import tsx --test src/**/*.test.ts`. Single file: `node --import tsx --test src/lib/db/estimate-history.test.ts`.
- Match existing code style: 2-space indent, no semicolons (match surrounding files), single quotes.
- Commit after each task. Branch: `feat/customer-historical-estimates`.

---

### Task 1: Pure merge/dedupe helper

**Files:**
- Create: `src/lib/db/estimate-history.ts`
- Test: `src/lib/db/estimate-history.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces:
  - `type EstimateTicketInput = { id: string; work_order_number: number | null; estimate_amount: number | null; status: string; decline_reason: string | null; estimated_at: string | null; problem_description: string | null }`
  - `type EstimateLogInput = { id: string; service_ticket_id: string | null; work_order_number: number | null; estimate_amount: number | null; outcome: string; decline_reason: string | null; problem_description: string | null; created_at: string }`
  - `type EquipmentEstimateHistoryRow = { key: string; source: 'ticket' | 'log'; service_ticket_id: string | null; work_order_number: number | null; estimate_amount: number | null; outcome: string; decline_reason: string | null; description: string | null; date: string | null }`
  - `function mergeEstimateHistory(tickets: EstimateTicketInput[], logs: EstimateLogInput[]): EquipmentEstimateHistoryRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/db/estimate-history.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeEstimateHistory,
  type EstimateTicketInput,
  type EstimateLogInput,
} from './estimate-history'

function ticket(over: Partial<EstimateTicketInput> = {}): EstimateTicketInput {
  return {
    id: 't1',
    work_order_number: 100,
    estimate_amount: 300,
    status: 'estimated',
    decline_reason: null,
    estimated_at: '2026-01-01T00:00:00Z',
    problem_description: 'leak',
    ...over,
  }
}

function log(over: Partial<EstimateLogInput> = {}): EstimateLogInput {
  return {
    id: 'l1',
    service_ticket_id: 't1',
    work_order_number: 100,
    estimate_amount: 300,
    outcome: 'declined',
    decline_reason: 'too pricey',
    problem_description: 'leak',
    created_at: '2025-12-01T00:00:00Z',
    ...over,
  }
}

test('maps a ticket row with estimate to a ticket-source row', () => {
  const rows = mergeEstimateHistory([ticket()], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'ticket')
  assert.equal(rows[0].service_ticket_id, 't1')
  assert.equal(rows[0].outcome, 'estimated')
  assert.equal(rows[0].estimate_amount, 300)
  assert.equal(rows[0].description, 'leak')
  assert.equal(rows[0].date, '2026-01-01T00:00:00Z')
  assert.equal(rows[0].key, 't:t1')
})

test('keeps a log snapshot whose ticket is NOT currently declined (superseded by re-quote)', () => {
  // ticket re-quoted and now approved at a different amount; old declined log survives
  const rows = mergeEstimateHistory(
    [ticket({ status: 'approved', estimate_amount: 500 })],
    [log({ estimate_amount: 300 })],
  )
  assert.equal(rows.length, 2)
  const log300 = rows.find((r) => r.source === 'log')
  assert.ok(log300)
  assert.equal(log300.estimate_amount, 300)
  assert.equal(log300.outcome, 'declined')
})

test('dedupes a log snapshot that restates a still-declined ticket at the same amount', () => {
  const rows = mergeEstimateHistory(
    [ticket({ status: 'declined', estimate_amount: 300 })],
    [log({ estimate_amount: 300 })],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'ticket')
})

test('keeps a log snapshot with null service_ticket_id (ticket deleted), no link', () => {
  const rows = mergeEstimateHistory([], [log({ service_ticket_id: null })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'log')
  assert.equal(rows[0].service_ticket_id, null)
})

test('sorts by date desc, null dates last', () => {
  const rows = mergeEstimateHistory(
    [
      ticket({ id: 'old', estimated_at: '2025-01-01T00:00:00Z' }),
      ticket({ id: 'new', estimated_at: '2026-06-01T00:00:00Z' }),
      ticket({ id: 'nodate', estimated_at: null }),
    ],
    [],
  )
  assert.deepEqual(
    rows.map((r) => r.service_ticket_id),
    ['new', 'old', 'nodate'],
  )
})

test('amount float noise does not break dedupe (300.00 vs 300)', () => {
  const rows = mergeEstimateHistory(
    [ticket({ status: 'declined', estimate_amount: 300.0 })],
    [log({ estimate_amount: 300.004 })], // rounds to same cents
  )
  assert.equal(rows.length, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/db/estimate-history.test.ts`
Expected: FAIL — `Cannot find module './estimate-history'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/db/estimate-history.ts`:

```ts
// Unified, deduped estimate ledger for one piece of equipment. Pure (no imports)
// so it can be unit-tested without a DB. Two sources are merged:
//   - service_tickets: the CURRENT estimate on each ticket (any status)
//   - equipment_estimate_log: durable DECLINED snapshots (migration 117) that
//     survive a re-quote (the live ticket row would otherwise overwrite them)
// A log snapshot that merely restates a ticket which is STILL declined at the
// same amount is a duplicate and hidden; a superseded one is kept as history.

export type EstimateTicketInput = {
  id: string
  work_order_number: number | null
  estimate_amount: number | null
  status: string
  decline_reason: string | null
  estimated_at: string | null
  problem_description: string | null
}

export type EstimateLogInput = {
  id: string
  service_ticket_id: string | null
  work_order_number: number | null
  estimate_amount: number | null
  outcome: string
  decline_reason: string | null
  problem_description: string | null
  created_at: string
}

export type EquipmentEstimateHistoryRow = {
  key: string
  source: 'ticket' | 'log'
  service_ticket_id: string | null
  work_order_number: number | null
  estimate_amount: number | null
  outcome: string
  decline_reason: string | null
  description: string | null
  date: string | null
}

const cents = (x: number | null): number => Math.round((x ?? 0) * 100)

export function mergeEstimateHistory(
  tickets: EstimateTicketInput[],
  logs: EstimateLogInput[],
): EquipmentEstimateHistoryRow[] {
  // Signatures of estimates that are CURRENTLY declined on a live ticket.
  const declinedSig = new Set(
    tickets
      .filter((t) => t.status === 'declined')
      .map((t) => `${t.id}|${cents(t.estimate_amount)}`),
  )

  const ticketRows: EquipmentEstimateHistoryRow[] = tickets.map((t) => ({
    key: `t:${t.id}`,
    source: 'ticket',
    service_ticket_id: t.id,
    work_order_number: t.work_order_number,
    estimate_amount: t.estimate_amount,
    outcome: t.status,
    decline_reason: t.decline_reason,
    description: t.problem_description,
    date: t.estimated_at,
  }))

  const logRows: EquipmentEstimateHistoryRow[] = logs
    .filter(
      (l) =>
        !(
          l.service_ticket_id &&
          declinedSig.has(`${l.service_ticket_id}|${cents(l.estimate_amount)}`)
        ),
    )
    .map((l) => ({
      key: `l:${l.id}`,
      source: 'log',
      service_ticket_id: l.service_ticket_id,
      work_order_number: l.work_order_number,
      estimate_amount: l.estimate_amount,
      outcome: l.outcome,
      decline_reason: l.decline_reason,
      description: l.problem_description,
      date: l.created_at,
    }))

  return [...ticketRows, ...logRows].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : -Infinity
    const db = b.date ? new Date(b.date).getTime() : -Infinity
    return db - da // newest first; null dates (-Infinity) sort last
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/db/estimate-history.test.ts`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/estimate-history.ts src/lib/db/estimate-history.test.ts
git commit -m "feat(estimate-history): pure merge/dedupe helper for equipment estimates"
```

---

### Task 2: Async fetcher `getEquipmentEstimateHistory`

**Files:**
- Modify: `src/lib/db/equipment.ts` (add new exported function; it currently exports `getEquipmentEstimateLog` near line 146)

**Interfaces:**
- Consumes: `mergeEstimateHistory`, `EstimateTicketInput`, `EstimateLogInput`, `EquipmentEstimateHistoryRow` from `./estimate-history` (Task 1).
- Produces: `function getEquipmentEstimateHistory(equipmentId: string): Promise<EquipmentEstimateHistoryRow[]>`

> No automated test: this function only wires Supabase queries to the pure helper (which is already tested), mirroring the untested sibling `getEquipmentEstimateLog`. It is covered by typecheck + the manual verification in Task 4.

- [ ] **Step 1: Add the import**

At the top of `src/lib/db/equipment.ts`, add alongside the existing imports:

```ts
import {
  mergeEstimateHistory,
  type EstimateTicketInput,
  type EstimateLogInput,
  type EquipmentEstimateHistoryRow,
} from './estimate-history'
```

- [ ] **Step 2: Add the fetcher**

Immediately after the existing `getEquipmentEstimateLog` function (ends ~line 159), add:

```ts
// Unified estimate ledger for the equipment detail page (all roles). Pulls every
// current estimate from service_tickets (any status, estimate set, not deleted)
// plus the durable declined snapshots from equipment_estimate_log, then merges +
// dedupes via mergeEstimateHistory. Both queries hit indexed equipment_id columns.
export async function getEquipmentEstimateHistory(
  equipmentId: string,
): Promise<EquipmentEstimateHistoryRow[]> {
  const supabase = await createClient()

  const [ticketsRes, logsRes] = await Promise.all([
    supabase
      .from('service_tickets')
      .select(
        'id, work_order_number, estimate_amount, status, decline_reason, estimated_at, problem_description',
      )
      .eq('equipment_id', equipmentId)
      .not('estimate_amount', 'is', null)
      .is('deleted_at', null),
    supabase
      .from('equipment_estimate_log')
      .select(
        'id, service_ticket_id, work_order_number, estimate_amount, outcome, decline_reason, problem_description, created_at',
      )
      .eq('equipment_id', equipmentId),
  ])

  if (ticketsRes.error) throw ticketsRes.error
  if (logsRes.error) throw logsRes.error

  return mergeEstimateHistory(
    (ticketsRes.data ?? []) as EstimateTicketInput[],
    (logsRes.data ?? []) as EstimateLogInput[],
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `createClient` is not already imported in this file, it is — `getEquipmentEstimateLog` above uses it.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/equipment.ts
git commit -m "feat(estimate-history): add getEquipmentEstimateHistory fetcher"
```

---

### Task 3: Generalize the `EstimateHistory` component

**Files:**
- Modify: `src/components/EstimateHistory.tsx` (full rewrite of prop type, heading, badge, field refs)

**Interfaces:**
- Consumes: `EquipmentEstimateHistoryRow` from `@/lib/db/estimate-history` (Task 1).
- Produces: default-exported `EstimateHistory` component now taking `items: EquipmentEstimateHistoryRow[]`.

> No component test harness exists in this repo (no testing-library dependency), matching the codebase's convention of not unit-testing presentational components. Verified by typecheck (Step 2) + manual check in Task 4.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/EstimateHistory.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { EquipmentEstimateHistoryRow } from '@/lib/db/estimate-history'

interface EstimateHistoryProps {
  items: EquipmentEstimateHistoryRow[]
  collapsible?: boolean
}

// Outcome → badge classes. Covers both ticket statuses and log outcomes; unknown
// values fall back to gray. Palette matches status badges used elsewhere in the app.
const OUTCOME_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  billed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  estimated: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  canceled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const classes =
    OUTCOME_BADGE[outcome] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${classes}`}
    >
      {outcome.replace(/_/g, ' ')}
    </span>
  )
}

function formatDate(date: string | null): string {
  return date ? new Date(date).toLocaleDateString() : '—'
}

// A unit's complete estimate ledger (migration 117 snapshots merged with live
// service-ticket estimates). Distinct from Service History, which shows WORK done;
// this shows what was QUOTED and its outcome. Mobile-first — techs view this.
export default function EstimateHistory({ items, collapsible = false }: EstimateHistoryProps) {
  const [expanded, setExpanded] = useState(!collapsible)

  if (items.length === 0) {
    return null
  }

  const header = (
    <div
      className={`px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${collapsible ? 'cursor-pointer select-none' : ''}`}
      onClick={collapsible ? () => setExpanded(!expanded) : undefined}
    >
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
        Estimate History ({items.length})
      </h2>
      {collapsible &&
        (expanded ? (
          <ChevronDown className="h-5 w-5 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
        ))}
    </div>
  )

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      {header}
      {expanded && (
        <>
          {/* Mobile cards */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700 md:hidden">
            {items.map((e) => (
              <div key={e.key} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {e.service_ticket_id ? (
                      <Link
                        href={`/service/${e.service_ticket_id}`}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {e.work_order_number ? `WO-${e.work_order_number}` : 'Estimate'}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900 dark:text-white">
                        {e.work_order_number ? `WO-${e.work_order_number}` : 'Estimate'}
                      </span>
                    )}
                    <OutcomeBadge outcome={e.outcome} />
                  </div>
                  {e.estimate_amount != null && (
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${e.estimate_amount.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>{formatDate(e.date)}</div>
                  {e.description && (
                    <div className="text-gray-700 dark:text-gray-300">{e.description}</div>
                  )}
                  {e.decline_reason && (
                    <div className="text-red-600 dark:text-red-400 italic">
                      Declined: {e.decline_reason}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Outcome</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Amount</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">What it was for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((e) => (
                  <tr key={e.key} className="hover:bg-gray-50 dark:hover:bg-gray-700 align-top">
                    <td className="px-5 py-3">
                      {e.service_ticket_id ? (
                        <Link
                          href={`/service/${e.service_ticket_id}`}
                          className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                          {e.work_order_number ? `WO-${e.work_order_number}` : '—'}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900 dark:text-white">
                          {e.work_order_number ? `WO-${e.work_order_number}` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(e.date)}
                    </td>
                    <td className="px-5 py-3">
                      <OutcomeBadge outcome={e.outcome} />
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {e.estimate_amount != null ? `$${e.estimate_amount.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 max-w-md">
                      {e.description || '—'}
                      {e.decline_reason && (
                        <div className="text-red-600 dark:text-red-400 italic mt-1">
                          Declined: {e.decline_reason}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck (component still has a caller passing the OLD type — expect an error here, fixed in Task 4)**

Run: `npm run typecheck`
Expected: ONE error, in `src/app/equipment/[id]/page.tsx`, that `estimateLog` (type `EquipmentEstimateLogRow[]`) is not assignable to `items: EquipmentEstimateHistoryRow[]`. This is expected and resolved in Task 4. (If you prefer a clean typecheck per task, do Task 4 immediately after — they are a pair.)

- [ ] **Step 3: Commit**

```bash
git add src/components/EstimateHistory.tsx
git commit -m "feat(estimate-history): render unified rows, all outcomes, rename heading"
```

---

### Task 4: Wire the equipment page + verify end-to-end

**Files:**
- Modify: `src/app/equipment/[id]/page.tsx` (swap the fetch on line 1 import, line 47 fetch, line 111 render)

**Interfaces:**
- Consumes: `getEquipmentEstimateHistory` (Task 2), updated `EstimateHistory` (Task 3).
- Produces: nothing downstream.

- [ ] **Step 1: Update the import (line 1)**

Change:

```ts
import { getEquipmentDetail, getEquipmentServiceHistory, getEquipmentEstimateLog } from '@/lib/db/equipment'
```

to:

```ts
import { getEquipmentDetail, getEquipmentServiceHistory, getEquipmentEstimateHistory } from '@/lib/db/equipment'
```

- [ ] **Step 2: Swap the fetch (in the `Promise.all` around line 44-48)**

Change the third element from `getEquipmentEstimateLog(id)` to `getEquipmentEstimateHistory(id)`, and rename the destructured variable `estimateLog` → `estimateHistory`:

```ts
  const [pmHistory, svcHistory, estimateHistory] = await Promise.all([
    getEquipmentServiceHistory(id),
    getServiceTicketsForEquipment(id),
    getEquipmentEstimateHistory(id),
  ])
```

- [ ] **Step 3: Update the render (line ~111)**

Change:

```tsx
      <EstimateHistory items={estimateLog} />
```

to:

```tsx
      <EstimateHistory items={estimateHistory} />
```

- [ ] **Step 4: Full typecheck**

Run: `npm run typecheck`
Expected: no errors (the Task 3 error is now resolved).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors in the touched files.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 6 new `estimate-history` tests.

- [ ] **Step 7: Manual verification (dev server)**

Run: `npm run dev`, then as needed:
- Open an equipment page (`/equipment/<id>`) for a unit with estimates → "Estimate History (N)" shows; rows newest-first; amounts and outcome badges render; declined rows show the reason.
- Find a unit with a declined-then-re-quoted ticket → both the old declined quote (log) and the current estimate (ticket) appear; a still-declined ticket is not doubled.
- Click a row's WO link → lands on the correct `/service/<id>`.
- Log in as a **technician** → the section and amounts are visible.
- A unit with no estimates → section renders nothing (unchanged behavior).

- [ ] **Step 8: Commit**

```bash
git add src/app/equipment/[id]/page.tsx
git commit -m "feat(estimate-history): wire unified estimate history into equipment page"
```

---

## Notes for the implementer

- `getEquipmentEstimateLog` may become unused after Task 4. Leave it in place — it is exported and may be used elsewhere; removing it is out of scope. (Quick check: `grep -rn getEquipmentEstimateLog src` — if the page was its only caller and you want to remove it, do so in Task 4's commit, but this is optional.)
- The same WO can appear in both Service History (the work) and Estimate History (the quote). This is intentional per the spec — not a bug.
- Do not add a migration. Do not add role/billing gates.
