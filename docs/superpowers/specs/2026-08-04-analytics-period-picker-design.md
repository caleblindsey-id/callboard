# Analytics period picker

**Feedback:** #86 — "On the Analytics page it would be nice to be able to change dates to view other months."
**Date:** 2026-08-04
**Branch:** `feedback/86-caleb-wants-a-date-month-selecto`

## Problem

`/analytics` can only ever show the current period. The Weekly/Monthly toggle
changes granularity but always anchors to today, so there is no way to look back
at a previous month's numbers.

This is a pure UI gap. The data layer is already fully date-driven:
`getTeamAnalytics(periodType, date, ticketType)` derives the KPI range, the
prior-period comparison, the effective targets (`.lte('effective_from', date)`)
and the 12-month trend window from its `date` argument
(`src/lib/db/analytics.ts:646,661,677`). Both API routes already accept and
validate `?date=YYYY-MM-DD`.

The only blockers are four hardcoded "today" call sites:

| File | Line | What it does |
| --- | --- | --- |
| `src/app/analytics/page.tsx` | 8 | SSR seed for the overview |
| `src/app/analytics/AnalyticsOverview.tsx` | 43 | client refetch on toggle change |
| `src/app/analytics/[technicianId]/page.tsx` | 22 | SSR seed for the drill-down |
| `src/app/analytics/[technicianId]/TechnicianProfile.tsx` | 52 | client refetch on toggle change |

No schema change, no API change, no query change.

## Design

### The control

New client component `src/components/analytics/PeriodPicker.tsx`, rendered in
the `PageHeader` `actions` slot alongside the existing ticket-type and period-type
toggles.

```
[ ‹ ]  [ August 2026  ▾ ]  [ › ]
```

**Arrows step by the active period type** — one month in Monthly mode, one week
in Weekly mode. This is the reason the design leads with arrows rather than a
bare `<input type="month">`: the page keeps its Weekly/Monthly toggle, and a
month-only picker would leave Weekly mode with no way to move.

**The dropdown** is a native `<select>` listing the last 24 months, newest
first, labelled `"August 2026"`. `SegmentedControl` is the wrong primitive — its
own doc block caps it at three options. The nearest prior art in the codebase is
the payout period `<select>` in `src/app/tech-payouts/PayoutTab.tsx`, whose
`periodLabel()` helper and styling this follows.

Selecting a month sets the anchor date to the **1st of that month**. In Weekly
mode that lands on the week containing the 1st, and the arrows then walk by week.
Keeping the dropdown visible in both modes (rather than hiding it in Weekly) is
deliberate: without it, reaching last spring in Weekly mode is ~26 arrow clicks.

**The next arrow is disabled at the current period.** Paging into the future
would only ever render zeros.

### Interaction with the existing toggles

Each control changes exactly one dimension. Changing ticket type or period type
**preserves the selected period**:

```
Viewing: June 2026 (Monthly, Combined)
  → click "Service"   = June 2026 (Monthly, Service)
  → click "Weekly"    = Week of Jun 1–7, 2026
```

Switching Monthly → Weekly keeps the anchor date, so you land on a week inside
the month you were already looking at. This matters because comparing PM vs
Service for a past month is a primary use of the feature; snapping back to today
on every toggle would make that unusable.

### Shared logic

New `src/lib/analytics-period.ts`:

- `stepPeriod(date, periodType, direction)` — move one week/month, UTC-noon
  anchored.
- `monthOptions(count, today)` — dropdown entries, newest first.
- `parseAnalyticsParams(raw)` — validate/normalise `{ period, date, type }`,
  falling back to `monthly` / today / `combined`.

`parseAnalyticsParams` exists because the same validation is currently inline in
`src/app/api/analytics/team/route.ts:5-26` and would otherwise be copied into
both SSR pages. One home, one test file.

The **API routes keep their strict 400s** rather than adopting the parser: a
lenient fallback there would turn a typo'd param into silently wrong-period data
instead of an error. They import the shared constants and `isValidDateKey`
instead, so the definitions stay in one place while the response behaviour is
unchanged. This also tightens them slightly — they previously accepted
`2026-02-31` (regex-valid, not a real day).

**All date math must use the same UTC-noon anchoring as `getMonthRange` /
`getWeekRange`** (`src/lib/db/analytics.ts:261-283`), or the picker's label and
the server's computed range can disagree at month edges.

### URL sync

The selected period is mirrored to the query string as
`?period=&date=&type=` using **`window.history.replaceState`**, which Next 16
supports and integrates with the router
(`node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md:300`).

`router.replace` is deliberately *not* used: these pages already fetch their own
data client-side through `/api/analytics/*`, so a router navigation would re-run
the server component and fetch the whole payload a second time on every arrow
click. The house `useUrlFilters` hook is skipped for the same reason — it is
built around `router.replace`.

Both SSR pages read `searchParams` and seed their initial data through
`parseAnalyticsParams`, matching the server half of the convention already used
by `src/app/tech-payouts/page.tsx`. Result: the view is shareable and survives a
refresh.

`Leaderboard` gains a small `query` prop so its two drill-down hrefs
(`Leaderboard.tsx:128,174`) carry the current period — clicking a technician
while viewing June keeps you in June rather than snapping to today. The
drill-down's back link carries it in the other direction.

## Out of scope

- **`BacklogPanel` stays point-in-time.** `computeBacklog` takes no date range —
  it reports open work as of now. A "historical backlog" would have to be
  reconstructed from ticket history and would be wrong if faked. The panel is
  already labelled as ignoring the period toggle.
- **No arbitrary start/end range picker.** Week and month granularity only,
  matching the period model the whole analytics module is built on.
- **Analytics' UTC month boundaries are not changed.** Payouts uses
  Central-anchored boundaries (`src/lib/business-time.ts`); analytics uses UTC.
  Reconciling them would shift every historical number and is a separate
  decision.

## Testing

`src/lib/analytics-period.test.ts` (`node:test` + `tsx`, per repo convention):

- `stepPeriod` monthly clamps at month ends — stepping back from Mar 31 must
  land in February, not skip it.
- `stepPeriod` weekly crosses year boundaries correctly.
- Future clamping: next-step from the current period is refused.
- `parseAnalyticsParams` rejects malformed dates, unknown period/ticket types,
  and falls back correctly on empty input.
- `monthOptions` ordering and labels.

Manual verification (done in-browser against the dev DB on 2026-08-04):

- Overview defaults to August 2026 with the next arrow disabled.
- Back arrow → July 2026; URL becomes `?period=monthly&date=2026-07-01&type=combined`
  with no page reload; KPIs, leaderboard order and prior-deltas all move.
- Deep link `?date=2026-03-01&type=service` renders March 2026 with Service
  preselected, server-side.
- Monthly → Weekly from March 2026 keeps the anchor and shows
  "Week of Feb 23 – Mar 1, 2026"; deltas switch to "vs last week".
- In weekly mode the back arrow steps 7 days (`2026-03-01` → `2026-02-22`),
  not a month.
- Clicking a technician from the July leaderboard opens the drill-down still on
  July 2026, with matching figures; its back link returns to July.
- No console errors or hydration warnings, including on a 9-month-back weekly
  PM deep link.

The month `<select>` could not be driven by browser automation (Chrome renders
the popup natively, outside the page), so its selection was not clicked
end-to-end. Its `onChange` calls the same handler the arrows use, and it renders
the correct current value in every case above.
