# PM Generated — Technician Notification

**Date:** 2026-07-30
**Status:** Approved, ready for implementation plan

## Problem

When a manager generates a month's PM tickets, the assigned technicians find out only
by opening CallBoard and noticing new rows on their board. There is no alert. A tech
who does not open the app for several days does not know next month's route exists.

## Goal

When PM tickets are generated for the current or a future month, every technician who
received at least one of them gets a personalized alert with their own count and a
deep link to their board for that month.

## Scope

In scope: in-app notification bell row, Web Push, a count line in the generate modal.

Out of scope: email channel, cron auto-generation, per-tech opt-out, re-notify or
reminder jobs, customer names in the notification body, any database migration.

## Existing context this builds on

- PM generation is manager-triggered from the month picker on `/tickets`, via
  `POST /api/tickets/generate`, which delegates to `generatePmTickets()` in
  `src/lib/pm-generation.ts`. There is no cron.
- Each PM ticket is created with `assigned_technician_id = equipment.default_technician_id`
  (`pm-generation.ts:309`), or `null` when the equipment has no default tech.
- `generatePmTickets` upserts with `onConflict: 'pm_schedule_id,month,year'` and
  `ignoreDuplicates: true`, then returns only the rows actually inserted. The returned
  `created` array is therefore already the true delta for a run.
- A three-channel notification stack exists: `createNotification()`
  (`src/lib/notifications/create-notification.ts`), `sendPushToUser()`
  (`src/lib/push/send-push.ts`), and Mandrill email.
  `src/lib/service-tickets/notify-assignment.ts` is the reference fan-out pattern.
- `/tickets` accepts `?month=&year=` and, for a technician role, auto-filters the board
  to that user's own tickets (`src/app/tickets/page.tsx:29`). One URL therefore lands
  each tech on exactly their own PMs for the month.
- `notifications.type` is free text; `NotificationBell.tsx` types it as `string` and
  renders generically. A new type value needs no migration.
- `BUSINESS_TIME_ZONE = 'America/Chicago'` already exists in `src/lib/format.ts`.

## Chosen approach

A new helper module called from the generate route. `generatePmTickets` stays a pure
generation service and is not modified.

Two approaches were rejected:

- **Notify inside `generatePmTickets()`.** Both callers would get it automatically, but
  the schedule-create backfill caller would then need a `notify: false` flag that a
  future edit could forget, and the generation service would acquire network I/O and a
  service-role dependency it does not otherwise have.
- **Cron sweep over recently created PM tickets.** No PM cron exists today, it would
  need a "already announced?" bookkeeping column, and it delays the alert.

## Architecture

Two new modules, split along the testability boundary described below.

`src/lib/pm-tickets/pm-notify-rules.ts` — pure, no server-side imports:

| Export | Responsibility |
| --- | --- |
| `shouldNotifyForMonth(month, year, now?)` | True when the generated month is current-or-future in `America/Chicago` |
| `groupCreatedByTechnician(created)` | Rows to `[{ technicianId, count }]`, dropping rows with a null technician |
| `buildPmNotification({ month, year, count, appUrl })` | The message payload: `{ title, body, url, tag }` |

`src/lib/pm-tickets/notify-generated.ts` — the I/O shell:

| Export | Responsibility |
| --- | --- |
| `notifyTechsOfGeneratedPms({ created, month, year })` | Fan out push + bell per technician, best-effort, returns the number of techs notified |

Call site: `src/app/api/tickets/generate/route.ts`, immediately after the existing
credit-review enqueue loop and before the response is built.

### Why the pure logic is a separate file

The `server-only` package's default export **throws at import time**
(`node_modules/server-only/index.js`), and both `create-notification.ts:11` and
`send-push.ts:8` import it. A `node --test` file that transitively pulled either in
would crash before its first assertion. Keeping the decisions and the copy in a module
that imports nothing server-side makes them testable; the I/O shell that cannot be unit
tested stays as thin as possible. This mirrors `src/lib/service-readiness.ts`, a tested
pure module that imports only types and other pure modules.

`buildPmNotification` takes `appUrl` as a parameter rather than reading
`process.env.NEXT_PUBLIC_APP_URL` itself, so the copy and the URL shape are assertable
without mutating the environment. The I/O shell reads the variable and passes it down.

### Why the timezone gate is not cosmetic

Vercel runs UTC. On July 31 at 11:00 pm CST the server clock reads August 1. A naive
`new Date()` comparison would classify a current-month July generation as "past" and
silently skip the notification. `shouldNotifyForMonth` resolves "today" through
`BUSINESS_TIME_ZONE` so the gate matches the branch's calendar, not the server's.

## Message content

```
title:  August 2026 PMs are ready
body:   14 PM tickets assigned to you.        // singular: "1 PM ticket assigned to you."
url:    {NEXT_PUBLIC_APP_URL}/tickets?month=8&year=2026
tag:    pm-generated-2026-08
type:   pm_tickets_generated
```

- The year is always present in the title so a December-generating-January alert cannot
  be misread.
- The push `tag` is keyed to the target month. A re-run replaces the existing
  lock-screen entry rather than stacking a second one.
- `url` falls back to the relative `/tickets?month=&year=` when `NEXT_PUBLIC_APP_URL` is
  unset, matching how `notify-assignment.ts` handles the same variable.
- `entityType` and `entityId` are both `null`. The notification points at a month, not a
  single row, and there is nothing for the bell to link beyond `url`.

## Data flow

1. Manager clicks Generate August PMs. `POST /api/tickets/generate` with `{ month, year }`.
2. Existing: auth gate against `MANAGER_ROLES`, then `generatePmTickets`.
3. Existing: credit-hold PMs enqueued to AR credit review.
4. New: when `preview` is false and `shouldNotifyForMonth(month, year)` is true, group
   `result.created` by `assigned_technician_id`, then for each technician call
   `sendPushToUser` followed by `createNotification`.
5. Response gains `notifiedTechs: number`. `GeneratePmModal.tsx` appends
   ` Notified 5 techs.` to the existing "Created N tickets." success line.

## Error handling

- Each channel is wrapped in its own try/catch, so a push failure never prevents the
  bell row from being written. This mirrors `notify-assignment.ts`.
- The entire notify block is additionally wrapped, so no notification failure can fail
  the generation request or lose tickets. Generated tickets are the source of truth;
  the alert is best-effort.
- `sendPushToUser` already short-circuits on the `outboundEnabled` kill-switch, so a
  dev or preview environment holding a copy of production data cannot push to a real
  technician's device.
- `notifiedTechs` counts a technician as notified when the **bell row** was written,
  regardless of the push outcome. The bell is the durable channel; push is best-effort
  delivery on top of it, and a tech with no subscription is still legitimately notified.

## Edge cases

| Case | Behavior |
| --- | --- |
| PM ticket with no default technician | Nobody notified; managers see it on the board |
| Re-run of the same month | Only the delta is announced, because `created` is post-`ignoreDuplicates` |
| Past-month generation (migration backfill) | Silent |
| Schedule-create auto-backfill (`POST /api/pm-schedules`) | Silent by construction; that route never calls the helper |
| Preview mode | Silent |
| Credit-hold or prior-PM-flagged tickets | Counted, because the technician does see them on their board |
| Technician with no push subscription | Bell row still written |
| Zero created tickets, or zero assigned | No-op, `notifiedTechs: 0` |

A technician told "14 PMs" before AR later voids a credit-hold PM will have been told a
number that is briefly stale. This is accepted: the count is a point-in-time snapshot of
what the board showed at generation, and the board itself stays correct.

## Testing

`src/lib/pm-tickets/pm-notify-rules.test.ts`, run by the existing
`node --import tsx --test "src/**/*.test.ts"` script and placed beside the module in the
same way as `src/lib/reorder/*.test.ts`.

`buildPmNotification`:
- singular copy at `count: 1` ("1 PM ticket assigned to you.")
- plural copy above 1
- title carries the month name and the year
- `tag` is zero-padded (`pm-generated-2026-08`)
- `url` carries the month and year query params, and degrades to a relative path when
  `appUrl` is empty

`groupCreatedByTechnician`:
- rows with a null `assigned_technician_id` are dropped
- counts per technician are correct across a mixed batch
- empty input returns an empty array

`shouldNotifyForMonth`:
- a future month returns true
- the current month returns true
- a past month returns false
- boundary: with `now` fixed at July 31, 11:00 pm CST (August 1 UTC), generating July
  still returns true

`notifyTechsOfGeneratedPms` is not unit tested. The repository has no Supabase mocking
layer and `notify-assignment.ts` is untested for the same reason. Matching the existing
codebase is preferred over introducing a mocking layer for one function.

## Files touched

- New: `src/lib/pm-tickets/pm-notify-rules.ts` (pure decisions + copy)
- New: `src/lib/pm-tickets/pm-notify-rules.test.ts`
- New: `src/lib/pm-tickets/notify-generated.ts` (I/O shell)
- Modified: `src/app/api/tickets/generate/route.ts` (call the helper, add `notifiedTechs`
  to the response)
- Modified: `src/app/tickets/GeneratePmModal.tsx` (read `notifiedTechs`, append it to the
  success line)

No migration. No changes to `src/lib/pm-generation.ts`.
