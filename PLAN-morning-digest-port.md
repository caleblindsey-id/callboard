# Plan: Port the Manager Morning Digest into CallBoard

## Context

The weekday 8 AM manager digest currently runs as a Python script on Caleb's desktop, queries Supabase over PostgREST, and sends through Outlook COM. That makes a branch-wide operational email depend on one PC being awake with Outlook open, and it forces the CallBoard email house style to be hand-copied into Python where it can drift.

Everything needed to run it properly already exists in this repo: three `CRON_SECRET`-authenticated Vercel crons, Mandrill wired to the verified `imperialdade.com` sending domain, eleven email templates, and a `src/lib/db/` layer that already answers most of the digest's questions.

The real prize is not the email vendor. It is that **the digest and the app would finally share one definition of each queue.** Today they are two implementations that can disagree, and they already do.

## Out of Scope

- No new digest sections beyond the thirteen that ship today.
- No Mission Control surface, no Outlook task creation (long-standing scope lock).
- No purchasing/reorder section. Migrations 142/143/144 are applied to prod, so those tables answer a query and return empty or stale data, but PR #254 is unmerged and no prod user can reach the UI.
- No change to the other three crons beyond retiring `warranty-credit-remind`.
- No redesign of the email. It keeps the current layout, chips, and owner grouping.

## Decisions taken

| Decision | Choice |
|---|---|
| From address | `service@imperialdade.com`, from-name **"Caleb Lindsey (via CallBoard)"**, Reply-To Caleb |
| Cutover | **Straight swap.** Verify one send to Caleb, then disable the Compass scheduled task the same day |
| Warranty overlap | **Retire** `warranty-credit-remind` and fold it into the digest |
| Recipients | `settings` table, editable by SQL without a deploy (mirrors `warranty_reminder_email`) |

## The bug that justifies Round 1

`getReadyToBillCounts()` in `src/lib/db/dashboard-metrics.ts:306` counts service tickets with `.eq('status','completed')` and **no `billing_exported` filter**, while the PM leg has one. Its comment is stale: it predates migration 106, which added `billing_exported` to `service_tickets`.

The `/billing` page itself is correct. `getServiceBillingByExported()` in `src/lib/db/service-tickets.ts:435` splits properly (`false` = Ready to Export, `true` = Awaiting Invoice #).

So the dashboard card and the billing page **disagree right now**. Measured against prod on 2026-08-20: the card counts **34**, the Ready to Export tab holds **21**. This is the same defect that was just fixed in the Python digest, from the same cause. Porting the digest without fixing this would import the bug into the new implementation.

## Rounds

### Round 1: Make the app's shared queue definitions correct and row-returning

**Scope:** Fix the ready-to-bill service count, and add row-returning siblings for the few sections that only expose counts, so one definition serves both the app and the digest.

**Files:**
- `src/lib/db/dashboard-metrics.ts`: add `.eq('billing_exported', false)` to the service leg of `getReadyToBillCounts()`; correct the stale comment above it.
- `src/lib/db/dashboard-metrics.ts`: new `getReadyToBillRows()` returning PM + service rows tagged by source, reusing the corrected filters.
- `src/lib/db/tickets.ts`: new `getOverdueTickets()` and `getSkipRequestedTickets()` row helpers built on the existing `OVERDUE_ELIGIBLE_STATUSES` constant, so the digest cannot invent a fourteenth definition of "overdue".
- `src/lib/db/ship-to-requests.ts`: new `getPendingShipToRequests()` (no helper exists today).
- `src/lib/db/service-tickets.ts`: new `getWarrantyToFile()` (lift the query out of the cron being retired in Round 5).

**Reuse, do not rewrite.** These already return the rows the digest needs and must be called as-is: `getPoFollowUpQueue()` (`service-tickets.ts`), `getDeclinedQueue()` (`declined-queue.ts`), `getEstimateQueue()` (`estimate-queue.ts`), `getPartsQueue()` (`parts-queue.ts`), `getOpenCreditReviews()` (`credit-reviews.ts`), `getEntriesByStatus()` (`ace-labor.ts`).

**Acceptance:** `getReadyToBillCounts().serviceCount` equals the length of `getServiceBillingByExported(false)`. Every digest section has exactly one row-returning function in `src/lib/db/`.

**Verification:** `npm run typecheck && npm run lint && npm run build`. Then compare each helper against SQL through the Supabase MCP on `haohkybnmnpuxpiykjvb` and state both numbers per section. The dashboard Ready to Bill card must drop to match the Ready to Export tab.

**Memory:** Log that the dashboard card and the billing page had disagreed since migration 106, and that a stale comment hid it.

---

### Round 2: Digest assembly module

**Scope:** One pure-ish module that turns the `src/lib/db/` helpers into thirteen ordered sections with counts, owner grouping, and distinct-entity keys.

**Files:**
- `src/lib/digest/sections.ts`: new. Exports `buildDigestSections()` returning `{ group, label, action, rows, count, keys, deepLink }[]`, plus `distinctTotal(sections)`.

**Carry over two things the Python version learned the hard way:**
1. **The headline counts distinct entities.** Sections legitimately overlap: a completed ticket for a PO-required customer is both ready-to-bill and waiting-on-a-PO, and a ticket idle in `estimated` is in two queues. On 2026-08-20 the naive sum was 127 and the true distinct count was 107. Key every row as `svc:<id>` / `pm:<id>` / `cust:<id>` / `lead:<id>` / `shipto:<id>` / `part:<n>`.
2. **Each section still shows its own true count.** Only the headline dedupes.

**Landmine:** the module must import nothing that pulls in `server-only`, or it throws at import time and cannot be unit tested. `src/lib/business-time.ts` documents this exact constraint and is the model to follow.

**Acceptance:** `buildDigestSections()` returns thirteen sections; `distinctTotal()` reproduces the dedupe (127 naive to 107 distinct on 2026-08-20 data).

**Verification:** `npm test` with a new `src/lib/digest/sections.test.ts` covering the overlap math against fixture rows. Then a live count comparison per section against the Python implementation's output, which is the current source of truth.

---

### Round 3: Email template

**Scope:** A pure render function producing the digest HTML and a plain-text fallback, matching the existing house style.

**Files:**
- `src/lib/email-templates/manager-digest.ts`: new. `renderManagerDigestEmail(sections, { date, total, errored })` returning `{ subject, html, text }`.

**Follow `warranty-credit-reminder.ts` exactly:** it is the closest analogue, a digest listing rows, and it is already the shape Mandrill expects. Templates here are pure (no DB, no fetch) and inline-styled, because every client strips `<style>`.

**Two behaviours to preserve from the Python version:**
- **The subject must be failure-aware.** When sections error the total is 0, and the old subject rendered "0 items need action", which reached Ken as a clean day on 2026-06-17 and 2026-08-03. On error the subject must say data is unavailable and name how many sections failed.
- **Empty sections are omitted** so the email stays an action list.

Classic-Outlook hardening is less critical here than in the Python version, since Mandrill mail renders the same way CallBoard's other emails already do, but keep the one-cell `bgcolor` table chips rather than styled spans.

**Acceptance:** Render matches the current email's structure: three owner bands, KPI tiles, top 5 rows per section with "+N more", deep links, footer CTA.

**Verification:** `npm test` snapshot over fixture sections, plus one real send to Caleb only and an eyeball in both new Outlook and classic Outlook desktop. A browser preview is not verification: it renders on a browser engine and looks perfect even when classic Outlook is broken.

---

### Round 4: Cron route, schedule, and recipients

**Scope:** The scheduled send, authenticated and DST-correct.

**Files:**
- `src/app/api/cron/manager-digest/route.ts`: new. Mirror `warranty-credit-remind/route.ts`: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `CRON_SECRET` bearer via `timingSafeCompare`, recipients via `parseEmailList` off `settings`.
- `vercel.json`: add the cron entry.
- `src/app/api/settings/route.ts`: add the two keys to `ALLOWED_KEYS`, and to `EMAIL_LIST_KEYS` so a value that parses to zero addresses is rejected.
- `src/app/settings/page.tsx` + `src/app/settings/SettingsContent.tsx`, surface them on the Settings page.

**No migration.** `warranty_reminder_email` was never seeded either: settings keys are created lazily by the Settings UI upsert, which is why the cron reads them with `.maybeSingle()` and tolerates a missing row. Follow that, do not add a seed migration.

**The DST trap.** Vercel crons are UTC with no DST handling. The three existing crons run at `13:00` UTC, which is 8 AM Central in summer but **7 AM in winter**. Do not repeat that. Schedule the cron to fire at both `12:00` and `13:00` UTC and have the handler no-op unless it is the 8 o'clock hour in `BUSINESS_TIME_ZONE`, using `src/lib/business-time.ts`. That file exists precisely because Vercel-UTC versus Central has bitten this repo before on money math.

**Weekday guard** in the handler, not just the cron expression, so a manual invocation on a Saturday cannot send.

**From-name and Reply-To:** `SendMandrillEmailInput` already has an optional `fromName`, so the "Caleb Lindsey (via CallBoard)" half is free. It has **no** `replyTo`, so add one (additive and optional, mapping to Mandrill's `headers['Reply-To']`) and leave every other send untouched.

**Recipients are one `to` plus the rest as `cc`**, exactly as `warranty-credit-remind/route.ts:139` does it. `preserve_recipients: true` is already set in the request body so all four see the list.

**Acceptance:** Hitting the route with a valid `CRON_SECRET` sends; without one it 401s. A 12:00 UTC invocation in summer no-ops and the 13:00 one sends; in winter the reverse. Weekend invocations no-op.

**Verification:** `curl` the route on a preview deployment with and without the bearer. Force both UTC hours with a fixed clock in a unit test. Confirm one real send lands in Caleb's inbox from the right name with Reply-To set.

**Rollback:** remove the `vercel.json` entry and redeploy. Nothing else depends on this round.

---

### Round 5: Straight swap and retire the old paths

**Scope:** Flip recipients, turn off the Python job, delete the superseded warranty cron, update the docs.

**Steps:**
1. Compare one Vercel send to Caleb against the same morning's Python send. Every section count must match. **This is the gate.** A straight swap is only safe if the translation is proven identical once.
2. `UPDATE settings SET value = 'ken.crummie@imperialdade.com' WHERE key = 'manager_digest_to';` and the CC list.
3. Disable the Compass scheduled task: `Disable-ScheduledTask -TaskName 'Compass CallBoard Morning Digest'`. Disable rather than delete for one week, so a rollback is one command.
4. Delete `src/app/api/cron/warranty-credit-remind/`, its `vercel.json` entry, and `src/lib/email-templates/warranty-credit-reminder.ts`. Its query moved to `getWarrantyToFile()` in Round 1.
5. In the Compass repo, mark the Python script superseded and update `wiki/knowledge/callboard-morning-digest.md`.

**Acceptance:** Ken receives the Vercel digest at 8 AM Central. The Compass task is disabled. No duplicate email.

**Verification:** Watch two consecutive weekday mornings. Confirm the Mandrill dashboard shows delivery to all four recipients, and that nothing arrives from Caleb's Outlook.

**Rollback:** re-enable the scheduled task and blank `manager_digest_to`. The Python version stays fully functional and correct on disk.

**Memory:** Update the Compass wiki doc and `MEMORY.md`; note in CallBoard's own docs that the digest now lives here.

## Repo conventions this must follow

Verified by reading the existing crons and templates. Getting any of these wrong costs a round.

- **Admin client:** `const admin = await createAdminClient('SERVER_ONLY')`. The guard argument is required, and `ADMIN_ONLY` would throw in a cron because there is no session. The `CRON_SECRET` check is what satisfies "caller handles its own authorization".
- **Settings reads in a cron use a route-local `getSetting`**, not `@/lib/db/settings`. That one uses the RLS-scoped client plus `.single()` and needs a logged-in user. Copy the six-line local version from `warranty-credit-remind/route.ts:161`.
- **`parseEmailList` lives in `src/lib/credit-review-crypto.ts:66`.** Odd home, but it is the canonical import.
- **Soft deletes:** every `service_tickets` / `pm_tickets` list or count read needs `.is('deleted_at', null)`. This is enforced by `npm test` against an allowlist (`src/lib/soft-delete-allowlist.ts`) for direct reads, but **not** for embedded joins. `AGENTS.md:19-64` is mandatory reading before adding the Round 1 helpers.
- **Query builder only.** No raw SQL and no `.rpc()` in a cron. `.rpc()` exists in this repo but only for transactional writes.
- **Embedded joins are cast through `unknown`** to a local `RawRow` type, because generated types do not model them.
- **Templates have no shared helpers.** Each of the eleven files defines its own private `escapeHtml`. The convention is copy-the-file, not import-a-helper. Escape every interpolated value, URLs included.
- **`text` is required** by `SendMandrillEmailInput`, and the house style builds it properly (a nullable-line array filtered and joined) rather than stripping the HTML.
- **`tags: ['manager-digest']`**, kebab-case matching the feature, and leave `track_clicks: false` alone.
- **Preview and dev are safe:** `CALLBOARD_OUTBOUND_ENABLED=false` short-circuits `sendMandrillEmail` and logs instead. Use it while iterating, and remember it means a preview deploy will never actually send.
- **No cron route has tests.** Put the real coverage in the pure modules (Rounds 2 and 3) and smoke the route with `curl`.

## A second divergence already found

The retiring cron scopes warranty work as `billing_type IN ('warranty', 'partial_warranty')`. The Python digest shipped on 2026-08-20 filtered `billing_type = 'warranty'` alone, so a `partial_warranty` ticket needing its claim filed would never appear. Impact today is zero (the single `partial_warranty` row is already filed) and the Compass side has been corrected, but it is a clean example of the problem this plan solves: two implementations, two definitions, and nothing forcing them to agree. `getWarrantyToFile()` in Round 1 becomes the single definition.

## Cross-Cutting Concerns

**Migrations**
- None. See Round 4: settings keys are created lazily, not seeded.

**Dependency order**
Rounds are strictly sequential: Round 2 consumes Round 1's helpers, Round 3 consumes Round 2's section shape, Round 4 wires 2 and 3 together, Round 5 flips traffic. Round 1 is the only one that ships user-visible value on its own (the dashboard card fix) and can go alone if the rest is deferred.

**Env vars**
None new. `MANDRILL_API_KEY`, `MANDRILL_FROM_EMAIL`, `MANDRILL_FROM_NAME`, and `CRON_SECRET` are already set in Vercel. If Round 4 adds per-send from-name, no env change is needed. Remember that env changes only apply to new deployments.

**Vercel plan**
Three crons already run on minute-level and weekly schedules, so this is a Pro plan and the fourth cron (plus its second daily hour) is within limits. Retiring the warranty cron nets it back to four total.

**What gets deleted at the end**
The scheduled task, the weekend guard, the last-sent state file, the beacon, and `report_beacon.py`. All of it exists only to work around the PC dependency this plan removes.

## Verification (end-to-end)

On a normal weekday after Round 5: at 8:00 AM Central, Ken, Caleb, Tim and Tamara each receive one email titled "CallBoard, N items need action", where N is the distinct-entity total. Every section count matches the equivalent SQL run through the Supabase MCP against `haohkybnmnpuxpiykjvb`, and matches what the corresponding CallBoard page shows when you click through. Caleb's PC is off.

## History

**SHIPPED 2026-08-21.** Delivered as two PRs rather than five sequential rounds, because the port was built before this plan was found (it was committed here the day before and not read). PR #280 reconciled the differences.

| | |
|---|---|
| `0afde6f` | PR #279, the port: 13 sections, cron route, template, Settings, parity harness |
| `8e355b1` | PR #280, realignment with this plan |

**Followed as written:** reuse `src/lib/db` definitions, settings-based recipients, distinct-entity dedupe with the six key prefixes, failure-aware subject, empty sections omitted, `server-only` kept out of the pure modules, `createAdminClient('SERVER_ONLY')`, route-local `getSetting`, `parseEmailList` from `credit-review-crypto`, both settings allowlists, no seed migration, from-name "Caleb Lindsey (via CallBoard)" with a new optional `replyTo` on `sendMandrillEmail`, weekday guard in the handler, `warranty-credit-remind` retired, straight swap after one proven send.

**Changed from this plan, deliberately:**

- **Cron hours are 13:00Z and 14:00Z, not 12:00Z and 13:00Z.** 8 AM Central is UTC-5 in summer and UTC-6 in winter, so the specified pair covers 7 AM and 8 AM in summer but 6 AM and 7 AM in winter, and the digest would have gone silent from November to March. A test walks all 365 days of 2026 including both DST transitions.
- **Round 1 row-helpers were not all added.** Instead every reused `src/lib/db` function gained an optional trailing `DigestDb`, so existing call sites are untouched and there is still exactly one definition per queue. `getShipToRequestsByStatus` and `getCreditHoldCustomers` were extracted as the plan intended.
- **`getWarrantyToFile()` was not created.** `getWarrantyQueue` was extended instead, which is what surfaced WO 699.

**Found while executing:**

- **WO 699**: warranty work completed 2026-05-22 and invoiced as Synergy 950933 with no vendor claim ever filed. Hidden because `getWarrantyQueue` gated on `status='completed'` and the ticket had moved to `billed`. `/warranty-queue` now has a "Billed, never claimed" bucket.
- **Round 1's bug confirmed live**: `getReadyToBillCounts()` service leg card 32 vs `/billing` Ready to Export tab 21, fixed.
- **Open gap**: retiring `warranty-credit-remind` left `awaiting_credit` chasing with no home. Zero such claims at cutover and that cron never sent (no settings row), but real if warranty volume grows.

**Parity at cutover:** 13 sections executed, 0 errors, 12 matched the Python exactly. The single delta was warranty (4 vs 2) and both dropped tickets were `open`/`in_progress` work with nothing yet to file.
