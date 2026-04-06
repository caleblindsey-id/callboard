# Technician Analytics — Design Spec

## Problem

PM Scheduler tracks ticket data (hours, billing, completion dates) but provides no way to evaluate technician performance. Management needs to answer: Are techs staying busy? Who's profitable? Who's falling behind? There are no analytics, leaderboards, targets, or trend views anywhere in the app.

## Solution

A two-page analytics hub accessible to managers and coordinators:

- **`/analytics`** — Team overview with KPI summary cards, sortable leaderboard, and team trend charts
- **`/analytics/[technicianId]`** — Individual deep-dive with scorecard, monthly trends, revenue breakdown, period comparisons, and recent ticket history

## Audience

Managers and coordinators only. Technicians do not see any analytics views.

## Goals

1. **Utilization** — Are techs staying busy? Who has capacity and who's overloaded?
2. **Profitability** — Which techs generate revenue vs. cost money? Who's efficient?
3. **Accountability** — Are tickets getting done on time? Who's falling behind?

---

## Data Model

### Schema Changes

**`users` table — new column:**

| Field | Type | Purpose |
|-------|------|---------|
| `hourly_cost` | `DECIMAL` (nullable) | Tech's base hourly pay rate for profitability calculations |

Managed via the Settings page user management section. Nullable — techs without a cost rate won't show profitability metrics. Commission tracking deferred to future.

**New table — `technician_targets`:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID PK | |
| `technician_id` | UUID FK → users | Which tech (nullable = team-wide default) |
| `metric` | TEXT | KPI name: `tickets_completed`, `revenue`, `avg_completion_days`, `revenue_per_hour` |
| `target_value` | DECIMAL | Goal number |
| `period_type` | TEXT | `weekly` or `monthly` |
| `effective_from` | DATE | When this target starts |
| `active` | BOOLEAN | Current or historical |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

- `technician_id = NULL` means team-wide default; individual targets override defaults
- `effective_from` + `active` allow target changes without losing history
- Partial unique index: `CREATE UNIQUE INDEX ON technician_targets (technician_id, metric, period_type) WHERE active = true` — prevents duplicate active targets
- RLS: manager/coordinator only

### Computed Metrics (query-time, not stored)

| Metric | Formula | Grain |
|--------|---------|-------|
| Tickets completed | `COUNT(*)` where status in (completed, billed) | per tech, per period |
| Revenue generated | `SUM(billing_amount)` | per tech, per period |
| Total hours | `SUM(hours_worked + COALESCE(additional_hours_worked, 0))` | per tech, per period |
| Labor cost | `total_hours * hourly_cost` | per tech, per period |
| Gross profit | `revenue - labor_cost` | per tech, per period |
| Revenue per hour | `revenue / total_hours` | per tech, per period |
| Avg completion time | `AVG(completed_date - scheduled_date)` in days | per tech, per period |
| Completion rate | `completed / (completed + assigned + in_progress + skipped)` | per tech, per period |
| Additional work rate | `COUNT(tickets with additional_hours > 0) / total_completed` | per tech, per period |

### Period-over-Period Metrics

- **MoM (Month-over-Month):** This month vs. last month for all computed metrics. Shown as absolute delta and percentage change.
- **YoY (Year-over-Year):** Same month this year vs. last year. Columns show "—" until 12+ months of data exist, then populate automatically.
- **WoW (Week-over-Week):** This week vs. last week, available when weekly period is selected.
- **Week definition:** Monday–Sunday (ISO 8601). Weekly aggregations group by ISO week number.

---

## Page 1: Team Overview (`/analytics`)

### Layout (top to bottom)

#### Header
- Title: "Technician Analytics"
- Period label: "Week of Mar 31 – Apr 6, 2026" or "April 2026"
- Weekly/Monthly toggle (controls all sections)

#### KPI Summary Cards (5-card grid)
- Tickets Completed — count + period-over-period delta
- Total Revenue — sum + delta
- Gross Profit — sum + delta
- Avg Hours/Ticket — average + delta (red = increase, green = decrease)
- Avg Completion Time — days + delta (red = increase, green = decrease)

Each card shows the team-wide aggregate for the selected period.

#### Leaderboard Table
- Sortable by: Revenue, Tickets, Profit, Efficiency (toggled via segmented control)
- Columns: Rank, Technician, Tickets, Revenue, Hours, $/Hour, Profit, vs Target
- Rank #1 gets gold badge, rest get gray
- Rows below 70% of target highlighted with red background tint
- Click any row → navigates to `/analytics/[technicianId]`

#### Team Trends Chart
- Monthly bar chart (Recharts)
- Toggleable metric: Revenue, Tickets, Profit Margin
- Shows actual bars (blue gradient by recency) + projected/future months (dashed outline)
- Prior year overlay line when YoY data available

---

## Page 2: Technician Profile (`/analytics/[technicianId]`)

### Layout (top to bottom)

#### Header
- Back link: "← Back to Analytics"
- Tech name, role, hourly cost
- Weekly/Monthly toggle

#### Scorecard Row (6-card grid)
- Tickets — count, target, vs-target badge
- Revenue — amount, target, vs-target badge
- Hours — total, avg per ticket
- Revenue/Hr — amount, MoM delta
- Gross Profit — amount, labor cost shown below
- Avg Completion — days, target, vs-target badge

#### Two-Column Section

**Left (60%): Monthly Trend Chart**
- Individual tech's metric over time (bar chart)
- Toggleable: Revenue, Tickets, Profit
- Dashed target line overlay
- Prior year comparison toggle when data exists

**Right (40%): Revenue Breakdown**
- Stacked horizontal bar: PM Flat Rate | Additional Labor | Additional Parts
- Formulas:
  - PM Flat Rate = `SUM(pm_schedules.flat_rate)` across completed/billed tickets
  - Additional Labor = `SUM(additional_hours_worked * labor_rate_per_hour)` from settings
  - Additional Parts = `SUM(additional_parts_used[].unit_price * quantity)`
  - Note: sum of components should equal `billing_amount`; any manager override difference is absorbed into PM Flat Rate
- Legend with dollar amounts for each category
- "Additional work rate" — percentage of tickets with add-on work (upsell indicator)

#### Period Comparison Table
- Compact table:

| Metric | This Month | Last Month | MoM Change | Same Month Last Year | YoY Change |
|--------|-----------|------------|------------|---------------------|------------|
| Tickets | — | — | — | — | — |
| Revenue | — | — | — | — | — |
| Profit | — | — | — | — | — |
| Hours | — | — | — | — | — |

YoY columns show "—" until 12+ months of data, then auto-populate.

#### Recent Tickets Table
- Columns: WO (link to ticket detail), Customer, Date, Hours, Revenue, Profit, Status
- Shows last 10 tickets by default
- "View all →" link to filtered ticket board

#### Set Targets
- Button opens form to set/edit targets for this tech
- Fields: tickets/month, revenue/month, avg completion days, revenue/hr
- Saves with `effective_from = today`
- Team-wide defaults settable from the overview page

---

## Targets & Benchmarks

### Threshold Colors
- **Green** (100%+ of target) — on track or exceeding
- **Yellow** (70–99% of target) — needs attention
- **Red** (below 70%) — falling behind

### Target Resolution
1. Check for individual target for the tech + metric + period type where `active = true` and `effective_from <= current date`, ordered by `effective_from DESC`, take first
2. If none, fall back to team-wide default (technician_id = NULL) with same logic
3. If no target exists, vs-target badges don't render

### Available Target Metrics
| Metric | Unit | Example |
|--------|------|---------|
| `tickets_completed` | count per period | 15/month |
| `revenue` | $ per period | $4,000/month |
| `avg_completion_days` | days | 2 days |
| `revenue_per_hour` | $/hr | $120/hr |

---

## Technical Approach

### Chart Library
**Recharts** — lightweight React charting library. Handles bar charts, line charts, stacked bars. Works well with Next.js server/client component split.

### Data Layer — `src/lib/db/analytics.ts`

Four new functions:

1. **`getTeamAnalytics(periodType, startDate, endDate)`**
   - Returns: team-wide KPI aggregates + per-tech rows for leaderboard
   - Queries: pm_tickets (aggregated by assigned_technician_id), users (names + hourly_cost), technician_targets
   - Computes: all metrics from the computed metrics table above
   - Includes prior period data for delta calculations

2. **`getTechnicianAnalytics(techId, periodType, startDate, endDate)`**
   - Returns: individual scorecard, monthly trend data (last 12 months), revenue breakdown, recent tickets, period comparison
   - Queries: pm_tickets (filtered by tech), users, pm_schedules (for flat_rate), technician_targets

3. **`getTechnicianTargets(techId?)`**
   - Returns: active targets for one tech (or all techs if no ID)
   - Resolves individual targets with team-wide fallbacks

4. **`setTechnicianTarget(techId, metric, value, periodType)`**
   - Deactivates previous target for same tech+metric+periodType
   - Inserts new target with `effective_from = today, active = true`

### API Routes

- `GET /api/analytics/team?period=weekly|monthly&date=YYYY-MM-DD` — team overview data
- `GET /api/analytics/technician/[id]?period=weekly|monthly&date=YYYY-MM-DD` — individual tech data
- `GET /api/analytics/targets?technicianId=X` — fetch targets
- `PUT /api/analytics/targets` — set/update a target

All routes require manager or coordinator role.

### Data Fetching Pattern
Server components fetch data and pass to client components for interactivity (period toggles, sort changes, chart metric switching). Same pattern as the rest of PM Scheduler.

### Performance
For 12 technicians and a few hundred tickets per month, query-time aggregation is fine. No materialized views or denormalized tables needed. If volume grows significantly, add indexes on `pm_tickets(assigned_technician_id, status, completed_date)`.

---

## Navigation & Access

- **Sidebar:** New "Analytics" item (BarChart3 icon from Lucide) between Billing and Settings
- **Access:** Manager and coordinator roles only (same enforcement as Billing — middleware + requireRole)
- **Routes:** `/analytics` and `/analytics/[technicianId]`

---

## Files Summary

| File | Action |
|------|--------|
| `supabase/migrations/023_technician_analytics.sql` | **Create** — hourly_cost column + technician_targets table + RLS |
| `src/types/database.ts` | **Modify** — add hourly_cost to UserRow, add TechnicianTargetRow, update Database interface |
| `src/lib/db/analytics.ts` | **Create** — 4 analytics query functions |
| `src/app/api/analytics/team/route.ts` | **Create** — team overview endpoint |
| `src/app/api/analytics/technician/[id]/route.ts` | **Create** — individual tech endpoint |
| `src/app/api/analytics/targets/route.ts` | **Create** — targets CRUD |
| `src/app/analytics/page.tsx` | **Create** — team overview server component |
| `src/app/analytics/AnalyticsOverview.tsx` | **Create** — team overview client component |
| `src/app/analytics/[technicianId]/page.tsx` | **Create** — tech profile server component |
| `src/app/analytics/[technicianId]/TechnicianProfile.tsx` | **Create** — tech profile client component |
| `src/components/analytics/KpiCard.tsx` | **Create** — reusable KPI card |
| `src/components/analytics/Leaderboard.tsx` | **Create** — sortable leaderboard table |
| `src/components/analytics/TrendChart.tsx` | **Create** — Recharts bar/line chart |
| `src/components/analytics/RevenueBreakdown.tsx` | **Create** — stacked bar + legend |
| `src/components/analytics/PeriodComparison.tsx` | **Create** — MoM/YoY comparison table |
| `src/components/analytics/TargetsForm.tsx` | **Create** — target setting modal |
| `src/components/Sidebar.tsx` | **Modify** — add Analytics nav item |
| `package.json` | **Modify** — add recharts dependency |

---

## Verification

1. Navigate to `/analytics` — see team KPI cards, leaderboard, trend chart
2. Toggle weekly/monthly — all sections update
3. Sort leaderboard by different metrics — ranking changes correctly
4. Click a tech row — navigates to `/analytics/[id]` with correct data
5. On tech profile — scorecard shows correct aggregates, trend chart renders, revenue breakdown matches ticket data
6. Period comparison table shows MoM deltas (YoY shows "—" until data exists)
7. Set a target for a tech — vs-target badges update with correct green/yellow/red
8. Set a team-wide default — techs without individual targets pick it up
9. Verify tech with no `hourly_cost` — profit metrics show "—" instead of incorrect numbers
10. Verify coordinator access works, technician access blocked
11. Mobile: pages remain usable (stacked cards, horizontal scroll on tables if needed)
