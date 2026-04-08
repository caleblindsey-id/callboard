# PM Scheduler: Technician UI, Role Enforcement & Settings

**Date:** 2026-03-26
**Status:** Design approved, pending implementation

---

## Context

PM Scheduler is live with 12 technician accounts synced from Synergy. Currently, all authenticated users — including techs — have unrestricted access to every page and API route. This means techs can see billing data, generate monthly tickets, bulk-assign work, manage equipment config, and access the full customer directory. That needs to be locked down. Additionally, the $75/hr labor rate is hardcoded and should be configurable.

**Goal:** Restrict technicians to a focused "view and complete my tickets" experience, enforce role-based access at every layer, and add a configurable labor rate setting.

---

## Architecture: Hybrid Cookie Guard + Per-Route Checks

**Why hybrid:** Middleware reads a lightweight `pm-role` cookie (zero DB calls per request) to redirect techs instantly from restricted pages. API routes and server components verify role from DB as defense-in-depth. This gives the best UX (no page flash) with no performance cost.

### Role Model

| Role | Access |
|------|--------|
| `manager` | Full access to all pages, routes, and actions |
| `coordinator` | Same as manager |
| `technician` | Dashboard (own data), My Tickets (assigned only), Ticket detail (assigned only) |
| `null` role | Treated as unauthorized — redirect to `/login`. Do not set `pm-role` cookie. |

---

## Phase 1: Auth Infrastructure

### New file: `src/lib/auth.ts`

Exports:
- `getCurrentUser(): Promise<UserRow | null>` — gets Supabase session, then fetches DB user row via `getUser(session.user.id)`
- `requireRole(...roles: UserRole[]): Promise<UserRow>` — calls `getCurrentUser()`, redirects to `/login` if no session or role is `null`, redirects to `/` if role not in allowed list, returns `UserRow` on success
- `isTechnician(role: UserRole | null): boolean` — predicate helper (returns false for null)
- `MANAGER_ROLES: UserRole[]` — `['manager', 'coordinator']`

### Cookie-setting mechanism

The login page (`src/app/login/page.tsx`) is a client component that calls `supabase.auth.signInWithPassword()` directly — there is no server-side auth callback. Since client components cannot set `httpOnly` cookies, the cookie is set by the **middleware** instead:

- On every authenticated request, if the `pm-role` cookie is missing or stale, middleware fetches the user's DB role (one-time cost) and sets the cookie in the response.
- The root layout (`src/app/layout.tsx`) also refreshes the cookie on every full page load as a secondary mechanism.
- If `user.role` is `null`, do not set the cookie — redirect to `/login`.

```
pm-role = "technician" | "manager" | "coordinator"
httpOnly, sameSite: strict, path: /
```

This avoids touching the login flow entirely and handles cookie refresh organically.

### Middleware update: `src/middleware.ts`

After existing session validation, read `pm-role` cookie. If `technician`:

**Allowed page paths:**
- `/` (dashboard)
- `/tickets` (ticket list)
- `/tickets/[id]` (ticket detail — regex: `/^\/tickets\/[^/]+$/`)
- `/login`

**Allowed API paths:**
- `/api/tickets/[id]` and sub-routes (PATCH for status, POST for complete)

All other paths: redirect to `/` for pages, return 403 JSON for API routes.

**Note:** Middleware is intentionally permissive on allowed API paths — it only blocks routes techs should never hit (generate, bulk-assign, billing, settings). Fine-grained restrictions within allowed routes (e.g., field-level blocking on PATCH, ownership checks) are the route handler's responsibility.

---

## Phase 2: User Context for Client Components

### New file: `src/components/UserProvider.tsx`

React context holding `{ id: string; role: UserRole; name: string }`.
- `UserProvider` component (wraps children, accepts user prop)
- `useUser()` hook for client components

### Root layout: `src/app/layout.tsx`

- Call `getCurrentUser()` server-side
- Wrap `LayoutShell` inside `UserProvider`: `<UserProvider user={...}><LayoutShell>{children}</LayoutShell></UserProvider>`
- This lets `Sidebar` (inside `LayoutShell`) access user role via `useUser()` hook
- Refresh the `pm-role` cookie here (keeps cookie fresh on every full page load)

---

## Phase 3: Sidebar Navigation

### Update: `src/components/Sidebar.tsx`

- Import `useUser()` from UserProvider
- Two nav configs:
  - **Manager/Coordinator:** Dashboard, Tickets, Equipment, Customers, Products, Billing, Settings (all 7)
  - **Technician:** Dashboard, My Tickets (2 items)
- Conditionally render based on `user.role`

---

## Phase 4: Dashboard Filtering

### Update: `src/app/page.tsx`

- Call `getCurrentUser()` at top
- If technician: pass `technicianId: user.id` to `getTickets()`
- `getTickets()` already supports this filter — no data layer changes
- Hide "Unassigned" count card for techs (they can't act on unassigned tickets)
- All other dashboard stats scope to the tech's tickets

---

## Phase 5: Tickets Page Filtering

### Update: `src/app/tickets/page.tsx`

- Call `getCurrentUser()`
- If tech: force `technicianId = user.id` filter (ignore query params)
- Pass `userRole` to `TicketBoard` component

### Update: `src/app/tickets/TicketBoard.tsx`

- Accept `userRole` prop
- If technician: hide "Generate Tickets" button, "Bulk Assign" button, technician filter dropdown

---

## Phase 6: API Route Protection

| Route | Current State | Change |
|-------|--------------|--------|
| `POST /api/tickets/generate` | Already checks manager/coordinator | None |
| `POST /api/tickets/bulk-assign` | No auth check | Add `requireRole('manager', 'coordinator')` |
| `PATCH /api/tickets/[id]` | No role check | Add ownership check: tech must be `assigned_technician_id`. Block field updates techs shouldn't make (e.g., `assigned_technician_id`, `scheduled_date`). Managers update freely. |
| `POST /api/tickets/[id]/complete` | No role check | Add ownership check: tech must be `assigned_technician_id`. Managers can complete any. |
| `GET /api/billing/export` | Already protected | None |
| `POST /api/billing/pdf` | Already protected | None |
| `POST /api/tickets` | No role check | Add `requireRole('manager', 'coordinator')` — techs cannot create tickets |
| `GET /api/sync/status` | No role check | No change needed — read-only, low sensitivity (last sync timestamp only) |

---

## Phase 7: Ticket Detail Access Control

### Update: `src/app/tickets/[id]/page.tsx`

- Call `getCurrentUser()`
- If tech and `ticket.assigned_technician_id !== user.id`: return `notFound()`
- Pass `userRole` and `userId` props to `TicketActions`

### Update: `src/app/tickets/[id]/TicketActions.tsx`

- Accept `userRole` and `userId` props
- Tech sees: "Start Work" (if assigned to them and status is `assigned`), completion form (if `in_progress`)
- Hide any reassign or reschedule controls for techs

---

## Phase 8: Page-Level Protection

Add `requireRole('manager', 'coordinator')` at the top of these server component pages:
- `src/app/equipment/page.tsx`
- `src/app/equipment/[id]/page.tsx`
- `src/app/customers/page.tsx`
- `src/app/customers/[id]/page.tsx`
- `src/app/products/page.tsx`
- `src/app/billing/page.tsx`
- `src/app/settings/page.tsx`

Defense-in-depth: middleware already redirects techs, but these checks handle stale cookies.

---

## Phase 9: Settings — Configurable Labor Rate

### New table: `settings`

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO settings (key, value) VALUES ('labor_rate_per_hour', '75');
```

### New file: `src/lib/db/settings.ts`

- `getSetting(key: string): Promise<string | null>`
- `setSetting(key: string, value: string): Promise<void>` (upsert)

### New API route: `src/app/api/settings/route.ts`

- `GET /api/settings?key=...` — returns value (any authenticated user)
- `PATCH /api/settings` — body `{ key, value }`, protected with `requireRole('manager', 'coordinator')`

### Update: Settings page

Add "System Settings" section to `SettingsContent.tsx`:
- Number input for labor rate ($/hr)
- Save button PATCHes `/api/settings`
- Only visible to managers/coordinators (page already protected)

### Update: `TicketActions.tsx`

- Accept `laborRate` prop (number) from parent server component
- Replace hardcoded `75` with `laborRate` on lines 280-281
- Parent fetches via `getSetting('labor_rate_per_hour')` and parses to number (default 75)

---

## Implementation Order

1. Auth infrastructure (Phase 1) — everything depends on this
2. User context (Phase 2) — Sidebar and client components need this
3. Sidebar (Phase 3) — immediate visible change
4. API route protection (Phase 6) — security-critical
5. Dashboard filtering (Phase 4) + Tickets filtering (Phase 5)
6. Ticket detail access control (Phase 7)
7. Page-level protection (Phase 8)
8. Settings labor rate (Phase 9) — independent, can parallelize

---

## Verification

1. **Log in as manager** — confirm all 7 nav items visible, full access to all pages and actions
2. **Log in as technician** — confirm only Dashboard + My Tickets visible, dashboard shows only assigned tickets, can start and complete assigned tickets, cannot access billing/equipment/customers/products/settings URLs (redirected to `/`)
3. **Tech tries restricted API routes** — POST /api/tickets/generate returns 403, POST /api/tickets/bulk-assign returns 403
4. **Tech tries to complete another tech's ticket** — returns 403
5. **Manager changes labor rate in settings** — verify ticket completion form uses new rate
6. **Cookie staleness test** — change a user's role in Supabase, confirm next page load refreshes the cookie and enforces the new role

---

## Critical Files

| File | Action |
|------|--------|
| `src/lib/auth.ts` | **New** — central role checking |
| `src/components/UserProvider.tsx` | **New** — React context for role |
| `src/lib/db/settings.ts` | **New** — settings data access |
| `src/app/api/settings/route.ts` | **New** — settings API |
| `src/middleware.ts` | **Modify** — add cookie-based role guard |
| `src/app/layout.tsx` | **Modify** — wrap in UserProvider, refresh cookie |
| `src/components/Sidebar.tsx` | **Modify** — conditional nav by role |
| `src/app/page.tsx` | **Modify** — filter dashboard for techs |
| `src/app/tickets/page.tsx` | **Modify** — filter tickets for techs |
| `src/app/tickets/TicketBoard.tsx` | **Modify** — hide manager-only controls |
| `src/app/tickets/[id]/page.tsx` | **Modify** — ownership check |
| `src/app/tickets/[id]/TicketActions.tsx` | **Modify** — role-aware UI, dynamic labor rate |
| `src/app/api/tickets/[id]/route.ts` | **Modify** — ownership check for techs |
| `src/app/api/tickets/[id]/complete/route.ts` | **Modify** — ownership check for techs |
| `src/app/api/tickets/bulk-assign/route.ts` | **Modify** — add requireRole |
| `src/app/settings/SettingsContent.tsx` | **Modify** — add labor rate config section |
| `src/app/equipment/page.tsx` | **Modify** — add requireRole |
| `src/app/customers/page.tsx` | **Modify** — add requireRole |
| `src/app/products/page.tsx` | **Modify** — add requireRole |
| `src/app/billing/page.tsx` | **Modify** — add requireRole |
