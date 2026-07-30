# PM Generated — Technician Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a manager generates PM tickets for the current or a future month, every technician who received at least one gets a bell notification and a Web Push carrying their own count and a deep link to their board for that month.

**Architecture:** A pure rules module (`pm-notify-rules.ts`) holds the month gate, the per-technician grouping, and the message copy. A thin I/O shell (`notify-generated.ts`) fans those out to the existing `sendPushToUser` and `createNotification` helpers. `POST /api/tickets/generate` calls the shell after its existing credit-review enqueue. `src/lib/pm-generation.ts` is not modified, which is what keeps the schedule-create backfill path silent by construction.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, `web-push`, `node --test` with `tsx`.

**Spec:** `docs/superpowers/specs/2026-07-30-pm-generated-tech-notification-design.md`

## Global Constraints

- **No database migration.** `notifications.type` is free text; `NotificationBell.tsx` types it as `string` and renders generically.
- **`src/lib/pm-generation.ts` must not be modified.** The backfill path stays silent because it never calls the notify helper, not because of a flag.
- **Never import `server-only` (directly or transitively) into a `*.test.ts` file.** Its default export throws at import time. `create-notification.ts` and `send-push.ts` both import it, so only `notify-generated.ts` may import them.
- **Notification `type` value is exactly `pm_tickets_generated`.**
- **No em-dashes or en-dashes in user-facing copy.** House rule. Applies to notification titles/bodies and modal text.
- **Timezone:** every "is this month past?" decision resolves through `BUSINESS_TIME_ZONE` (`'America/Chicago'`, exported from `src/lib/format.ts`). Never the raw server clock — Vercel runs UTC.
- **`notifiedTechs` counts bell rows written, not pushes sent.**
- Commands: `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 1: Pure notification rules

**Files:**
- Create: `src/lib/pm-tickets/pm-notify-rules.ts`
- Test: `src/lib/pm-tickets/pm-notify-rules.test.ts`

**Interfaces:**
- Consumes: `BUSINESS_TIME_ZONE` from `@/lib/format`, `formatMonthYear` from `@/lib/utils/schedule`, `PmTicketRow` from `@/types/database` (type-only import).
- Produces:
  - `type TechnicianPmCount = { technicianId: string; count: number }`
  - `type PmNotificationPayload = { title: string; body: string; url: string; tag: string }`
  - `shouldNotifyForMonth(month: number, year: number, now?: Date): boolean`
  - `groupCreatedByTechnician(created: Pick<PmTicketRow, 'assigned_technician_id'>[]): TechnicianPmCount[]`
  - `buildPmNotification(input: { month: number; year: number; count: number; appUrl: string }): PmNotificationPayload`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pm-tickets/pm-notify-rules.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPmNotification,
  groupCreatedByTechnician,
  shouldNotifyForMonth,
} from './pm-notify-rules'

const TECH_A = '11111111-1111-1111-1111-111111111111'
const TECH_B = '22222222-2222-2222-2222-222222222222'

// Fixed clock: 12:00 PM CDT on July 15 2026 (CDT is UTC-5 in July).
const MID_JULY = new Date('2026-07-15T17:00:00Z')

test('shouldNotifyForMonth: a future month notifies', () => {
  assert.equal(shouldNotifyForMonth(8, 2026, MID_JULY), true)
})

test('shouldNotifyForMonth: the current month notifies', () => {
  assert.equal(shouldNotifyForMonth(7, 2026, MID_JULY), true)
})

test('shouldNotifyForMonth: a past month is silent', () => {
  assert.equal(shouldNotifyForMonth(3, 2026, MID_JULY), false)
})

test('shouldNotifyForMonth: December of a prior year is silent', () => {
  assert.equal(shouldNotifyForMonth(12, 2025, MID_JULY), false)
})

test('shouldNotifyForMonth: January of next year notifies', () => {
  assert.equal(shouldNotifyForMonth(1, 2027, MID_JULY), true)
})

// This is the whole reason the gate resolves "today" through America/Chicago
// instead of the server clock. Vercel runs UTC, so at 11 PM CDT on July 31 the
// server reads August 1. A UTC-based gate would classify a current-month July
// run as "past" and go silent. 2026-08-01T04:00:00Z == July 31 11:00 PM CDT.
test('shouldNotifyForMonth: July still notifies at 11 PM CDT on July 31 (Aug 1 in UTC)', () => {
  const lateJuly = new Date('2026-08-01T04:00:00Z')
  assert.equal(shouldNotifyForMonth(7, 2026, lateJuly), true)
})

test('groupCreatedByTechnician: counts per technician across a mixed batch', () => {
  const result = groupCreatedByTechnician([
    { assigned_technician_id: TECH_A },
    { assigned_technician_id: TECH_B },
    { assigned_technician_id: TECH_A },
  ])
  const sorted = [...result].sort((a, b) => a.technicianId.localeCompare(b.technicianId))
  assert.deepEqual(sorted, [
    { technicianId: TECH_A, count: 2 },
    { technicianId: TECH_B, count: 1 },
  ])
})

test('groupCreatedByTechnician: drops unassigned rows', () => {
  const result = groupCreatedByTechnician([
    { assigned_technician_id: null },
    { assigned_technician_id: TECH_A },
    { assigned_technician_id: null },
  ])
  assert.deepEqual(result, [{ technicianId: TECH_A, count: 1 }])
})

test('groupCreatedByTechnician: empty input returns an empty array', () => {
  assert.deepEqual(groupCreatedByTechnician([]), [])
})

test('groupCreatedByTechnician: an all-unassigned batch returns an empty array', () => {
  assert.deepEqual(groupCreatedByTechnician([{ assigned_technician_id: null }]), [])
})

test('buildPmNotification: title carries the month name and the year', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 14, appUrl: 'https://cb.app' })
  assert.equal(n.title, 'August 2026 PMs are ready')
})

test('buildPmNotification: plural body above one', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 14, appUrl: 'https://cb.app' })
  assert.equal(n.body, '14 PM tickets assigned to you.')
})

test('buildPmNotification: singular body at exactly one', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 1, appUrl: 'https://cb.app' })
  assert.equal(n.body, '1 PM ticket assigned to you.')
})

test('buildPmNotification: url deep-links to the month board', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.url, 'https://cb.app/tickets?month=8&year=2026')
})

test('buildPmNotification: a trailing slash on appUrl does not double up', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app/' })
  assert.equal(n.url, 'https://cb.app/tickets?month=8&year=2026')
})

test('buildPmNotification: empty appUrl degrades to a relative path', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: '' })
  assert.equal(n.url, '/tickets?month=8&year=2026')
})

// Keyed to the target month so a re-run replaces the lock-screen entry instead
// of stacking a second one. Zero-padded so it sorts and reads consistently.
test('buildPmNotification: tag is zero-padded and month-keyed', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.tag, 'pm-generated-2026-08')
})

test('buildPmNotification: tag zero-padding holds for a two-digit month', () => {
  const n = buildPmNotification({ month: 12, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.tag, 'pm-generated-2026-12')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="shouldNotifyForMonth|groupCreatedByTechnician|buildPmNotification"`

Expected: FAIL. The error is a module resolution failure — `Cannot find module './pm-notify-rules'` — because the implementation does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pm-tickets/pm-notify-rules.ts`:

```typescript
// Pure decisions and copy behind the "next month's PMs are ready" technician
// alert. Deliberately free of server-side imports: the `server-only` package
// throws at import time, and both create-notification and send-push import it,
// so anything reachable from a *.test.ts file has to live here rather than in
// notify-generated.ts.

import { BUSINESS_TIME_ZONE } from '@/lib/format'
import { formatMonthYear } from '@/lib/utils/schedule'
import type { PmTicketRow } from '@/types/database'

export type TechnicianPmCount = { technicianId: string; count: number }

export type PmNotificationPayload = {
  title: string
  body: string
  url: string
  tag: string
}

// Is the generated month the current one or later, on the branch's calendar?
// Resolved through America/Chicago, never the raw server clock: Vercel runs UTC,
// so at 11 PM CDT on July 31 a naive comparison reads August and would classify
// a current-month July run as "past".
export function shouldNotifyForMonth(month: number, year: number, now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)

  const todayYear = Number(parts.find((p) => p.type === 'year')?.value)
  const todayMonth = Number(parts.find((p) => p.type === 'month')?.value)
  if (!Number.isFinite(todayYear) || !Number.isFinite(todayMonth)) return false

  return year * 12 + month >= todayYear * 12 + todayMonth
}

// Newly created PM tickets to one entry per technician. Rows with no assigned
// technician are dropped: nobody is notified about them, and managers already
// see them on the board.
export function groupCreatedByTechnician(
  created: Pick<PmTicketRow, 'assigned_technician_id'>[],
): TechnicianPmCount[] {
  const counts = new Map<string, number>()
  for (const ticket of created) {
    const id = ticket.assigned_technician_id
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return Array.from(counts, ([technicianId, count]) => ({ technicianId, count }))
}

// `appUrl` is a parameter rather than a process.env read so the copy and the URL
// shape stay assertable without mutating the environment.
export function buildPmNotification({
  month,
  year,
  count,
  appUrl,
}: {
  month: number
  year: number
  count: number
  appUrl: string
}): PmNotificationPayload {
  const base = appUrl.replace(/\/$/, '')
  return {
    // Year is always present so a December-generating-January alert cannot be
    // misread as the month just gone.
    title: `${formatMonthYear(month, year)} PMs are ready`,
    body: `${count} PM ticket${count === 1 ? '' : 's'} assigned to you.`,
    url: `${base}/tickets?month=${month}&year=${year}`,
    tag: `pm-generated-${year}-${String(month).padStart(2, '0')}`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="shouldNotifyForMonth|groupCreatedByTechnician|buildPmNotification"`

Expected: PASS, 18 tests (6 for `shouldNotifyForMonth`, 4 for `groupCreatedByTechnician`, 8 for `buildPmNotification`).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: both clean. If `lint` objects to the `Pick<PmTicketRow, ...>` type-only import, confirm it is written as `import type { PmTicketRow }` — a value import of a types-only module is the usual cause.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pm-tickets/pm-notify-rules.ts src/lib/pm-tickets/pm-notify-rules.test.ts
git commit -m "feat(pm): pure rules for the PM-generated tech alert

Month gate, per-tech grouping, and message copy for the notification
that fires when a month's PMs are generated. Kept free of server-side
imports so it is reachable from a node --test file: server-only throws
at import time and both notification helpers import it.

The gate resolves today through America/Chicago rather than the server
clock, because Vercel runs UTC and a current-month run late on the 31st
would otherwise read as past and go silent."
```

---

### Task 2: I/O fan-out shell

**Files:**
- Create: `src/lib/pm-tickets/notify-generated.ts`

**Interfaces:**
- Consumes: `shouldNotifyForMonth`, `groupCreatedByTechnician`, `buildPmNotification` from `./pm-notify-rules` (Task 1); `sendPushToUser` from `@/lib/push/send-push`; `createNotification` from `@/lib/notifications/create-notification`; `PmTicketRow` from `@/types/database`.
- Produces: `notifyTechsOfGeneratedPms(input: { created: Pick<PmTicketRow, 'assigned_technician_id'>[]; month: number; year: number; now?: Date }): Promise<number>` — resolves to the count of technicians for whom a bell row was written.

This task has no unit test. The repository has no Supabase mocking layer, and `src/lib/service-tickets/notify-assignment.ts` — the pattern this mirrors — is untested for the same reason. All of the logic worth asserting was pushed into Task 1 precisely so this shell could stay assertion-free. Verification here is typecheck, lint, and the Task 3 manual run.

- [ ] **Step 1: Write the implementation**

Create `src/lib/pm-tickets/notify-generated.ts`:

```typescript
// "Next month's PMs are ready" technician alert. Called by
// POST /api/tickets/generate after tickets are created, so a tech learns their
// route exists without having to open the app and notice new rows.
//
// Two channels, matching notify-assignment.ts: Web Push for the phone, and an
// in-app notification row for the bell. No email — this is a once-a-month,
// non-urgent event and does not warrant a message in everyone's inbox.
//
// Best-effort by contract. Each channel is wrapped separately so a push failure
// never costs a tech their bell row, and the caller wraps the whole call so no
// notification failure can fail the generation request. Generated tickets are
// the source of truth; the alert rides on top.
//
// Deliberately NOT called from generatePmTickets(): the schedule-create backfill
// path in POST /api/pm-schedules also generates tickets, always for past months,
// and it stays silent by never calling this rather than by passing a flag a
// future edit could forget.

import 'server-only'
import { createNotification } from '@/lib/notifications/create-notification'
import { sendPushToUser } from '@/lib/push/send-push'
import type { PmTicketRow } from '@/types/database'
import {
  buildPmNotification,
  groupCreatedByTechnician,
  shouldNotifyForMonth,
} from './pm-notify-rules'

export type NotifyGeneratedPmsInput = {
  created: Pick<PmTicketRow, 'assigned_technician_id'>[]
  month: number
  year: number
  now?: Date
}

// Returns the number of technicians who got a bell row. Push delivery is not
// counted: the bell is the durable channel, and a tech with no push
// subscription has still legitimately been notified.
export async function notifyTechsOfGeneratedPms({
  created,
  month,
  year,
  now,
}: NotifyGeneratedPmsInput): Promise<number> {
  if (!shouldNotifyForMonth(month, year, now)) return 0

  const groups = groupCreatedByTechnician(created)
  if (groups.length === 0) return 0

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let notified = 0

  for (const { technicianId, count } of groups) {
    const payload = buildPmNotification({ month, year, count, appUrl })

    // Push first, mirroring notify-assignment.ts. sendPushToUser already
    // short-circuits on the outboundEnabled kill-switch, so a preview
    // environment holding a copy of prod data cannot reach a real device.
    try {
      await sendPushToUser(technicianId, {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
      })
    } catch (err) {
      console.error('notifyTechsOfGeneratedPms: push send failed', technicianId, err)
    }

    // The bell row. entityType/entityId are null: this points at a month, not a
    // single row, and there is nothing to link beyond url.
    try {
      const id = await createNotification(technicianId, {
        type: 'pm_tickets_generated',
        title: payload.title,
        body: payload.body,
        url: payload.url,
        entityType: null,
        entityId: null,
      })
      if (id) notified++
    } catch (err) {
      console.error('notifyTechsOfGeneratedPms: in-app notification failed', technicianId, err)
    }
  }

  return notified
}
```

- [ ] **Step 2: Verify the test suite still passes and nothing regressed**

Run: `npm test`

Expected: PASS, **337 tests** (the baseline measured on this branch before Task 1 was 319, plus the 18 added). Read the `ℹ tests` line, not just the exit status: a suite that silently shrinks still exits 0. If the number is below 337, a test file stopped being picked up — investigate before continuing rather than moving on.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pm-tickets/notify-generated.ts
git commit -m "feat(pm): fan the PM-generated alert out to push and the bell

Thin I/O shell over the Task 1 rules. Each channel is wrapped separately
so a push failure never costs a tech their bell row, and the returned
count tracks bell rows rather than pushes: the bell is the durable
channel and a tech with no subscription is still notified.

Not called from generatePmTickets on purpose. The schedule-create
backfill also generates tickets, always for past months, and stays
silent by never calling this rather than by a flag someone could drop."
```

---

### Task 3: Wire into the generate route

**Files:**
- Modify: `src/app/api/tickets/generate/route.ts`

**Interfaces:**
- Consumes: `notifyTechsOfGeneratedPms` from `@/lib/pm-tickets/notify-generated` (Task 2).
- **Read this carefully, the two names are easy to swap.** `generatePmTickets` returns a `GeneratePmTicketsResult` (`src/lib/pm-generation.ts:68-85`) in which `created` is a **number** (the count of inserted rows) and `tickets` is the **`PmTicketRow[]`** of the rows actually inserted (`aggregate.tickets.push(...monthResult.created)` at line ~180). Pass **`result.tickets`** to the notify helper, not `result.created`. The existing `created: result.created` line in the response body is a count and stays exactly as it is.
- Produces: a `notifiedTechs: number` field on the `POST /api/tickets/generate` JSON response. Task 4 reads it.

The preview branch returns early at line 45 and is therefore already silent; no guard is needed for it.

- [ ] **Step 1: Add the import**

In `src/app/api/tickets/generate/route.ts`, add below the existing `enqueueCreditReviewsForCustomer` import:

```typescript
import { notifyTechsOfGeneratedPms } from '@/lib/pm-tickets/notify-generated'
```

- [ ] **Step 2: Call the helper after the credit-review loop**

The existing code ends the credit-review loop and then returns. Insert the notify block between the closing brace of the `for (const [customerId, info] of byCustomer)` loop and the `return NextResponse.json({` that follows it:

```typescript
    // Tell each tech their month is ready. Best-effort and fully contained: the
    // tickets are already committed, so a notification failure must never turn
    // a successful generation into an error the manager sees.
    let notifiedTechs = 0
    try {
      notifiedTechs = await notifyTechsOfGeneratedPms({
        // result.tickets, NOT result.created — created is a count, tickets is
        // the PmTicketRow[] of rows actually inserted this run.
        created: result.tickets,
        month,
        year,
      })
    } catch (err) {
      console.error('tickets/generate: tech notification failed', err)
    }
```

- [ ] **Step 3: Add the field to the response**

In the same file, add `notifiedTechs` to the returned object so it sits alongside the other counts:

```typescript
    return NextResponse.json({
      created: result.created,
      skipped: result.skipped,
      flagged: result.flagged,
      pendingReview: result.pendingReview,
      pendingReviewCustomers: byCustomer.size,
      creditReviewEmailed: emailedCustomers,
      creditReviewNotEmailed: unemailedCustomers,
      notifiedTechs,
      tickets: result.tickets,
    })
```

- [ ] **Step 4: Typecheck, lint, and run the suite**

Run: `npm run typecheck && npm run lint && npm test`

Expected: all three clean, test count unchanged from Task 2.

- [ ] **Step 5: Verify against dev, not just the compiler**

This is the step that proves the feature works. Run against the dev environment, never production.

1. Start the app: `npm run dev`
2. Sign in as the dev super_admin (`compass-test@callboard.dev`; credentials in `CLAUDE.local.md`).
3. Go to `/tickets`, set the month picker to **next month**, and click Generate PMs.
4. Confirm the JSON response in the browser devtools Network tab contains `notifiedTechs` with a value matching the number of distinct technicians among the created tickets.
5. Query the dev database to confirm the rows landed:

```sql
select user_id, type, title, body, url, created_at
from notifications
where type = 'pm_tickets_generated'
order by created_at desc
limit 20;
```

Expected: one row per technician who received PMs, title reading `<Month> <Year> PMs are ready`, body carrying that technician's own count, url deep-linking to `/tickets?month=&year=` for the generated month.

6. Now the negative case, which is the one most likely to be silently wrong: set the month picker to a **past** month, generate, and confirm the response has `notifiedTechs: 0` and that the query above returns no new rows.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/tickets/generate/route.ts
git commit -m "feat(pm): notify assigned techs when a month's PMs generate

Fires after the credit-review enqueue, wrapped so a notification failure
cannot turn a committed generation into an error the manager sees. The
preview branch returns earlier and is already silent.

Response gains notifiedTechs for the modal to report back."
```

---

### Task 4: Report the count in the generate modal

**Files:**
- Modify: `src/app/tickets/GeneratePmModal.tsx`

**Interfaces:**
- Consumes: the `notifiedTechs` field added to the generate response in Task 3.
- Produces: nothing consumed by later tasks.

Without this, a manager clicks Generate and has no idea whether anyone was told. It is the confirmation half of the feature.

- [ ] **Step 1: Add the field to the result interface**

In `src/app/tickets/GeneratePmModal.tsx`, extend `interface GenerateResult` (around line 23):

```typescript
interface GenerateResult {
  created: number
  pendingReview: number
  flagged: number
  creditReviewNotEmailed: number
  notifiedTechs: number
}
```

- [ ] **Step 2: Read it off the response**

In the same file, in the `setResult({ ... })` call (around line 105), add the field:

```typescript
      setResult({
        created: data.created ?? 0,
        pendingReview: data.pendingReview ?? 0,
        flagged: data.flagged ?? 0,
        creditReviewNotEmailed: data.creditReviewNotEmailed ?? 0,
        notifiedTechs: data.notifiedTechs ?? 0,
      })
```

- [ ] **Step 3: Append it to the success line**

In the same file, in the success paragraph (around line 147), add a third clause after the credit-review one. Note the house rule: no em-dashes or en-dashes in user-facing copy.

```tsx
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Created {result.created} ticket{result.created === 1 ? '' : 's'}.
                {result.pendingReview > 0 && (
                  <> {result.pendingReview} sent to AR for credit review.</>
                )}
                {result.notifiedTechs > 0 && (
                  <> Notified {result.notifiedTechs} tech{result.notifiedTechs === 1 ? '' : 's'}.</>
                )}
              </p>
```

- [ ] **Step 4: Typecheck, lint, and run the suite**

Run: `npm run typecheck && npm run lint && npm test`

Expected: all three clean, test count unchanged.

- [ ] **Step 5: Verify in the browser**

With `npm run dev` running and signed in as the dev super_admin:

1. Generate PMs for a **future** month and confirm the success panel reads, for example, `Created 47 tickets. Notified 5 techs.`
2. Generate for a **past** month and confirm the sentence stops after `Created N tickets.` with no "Notified" clause, since `notifiedTechs` is 0.
3. Re-run the same future month. Confirm `Created 0 tickets.` with no "Notified" clause, because `created` is post-`ignoreDuplicates` and there is no delta to announce.

- [ ] **Step 6: Commit**

```bash
git add src/app/tickets/GeneratePmModal.tsx
git commit -m "feat(pm): report the notified-tech count in the generate modal

A manager clicking Generate had no signal that anyone was told. The
clause is suppressed at zero, so past-month backfills and no-op re-runs
read the same as they always did."
```

---

## Done

After Task 4, run the full gate once more and push:

```bash
npm run typecheck && npm run lint && npm test && npm run build
git push -u origin feat/pm-generated-tech-notification
```

Then open a PR. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, and a test-count floor. The floor asserts a minimum of 250 (`ci.yml:57`), and this branch takes the suite from 319 to 337, so **no CI change is needed**.
