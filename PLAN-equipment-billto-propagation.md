# Plan: Equipment Bill-To Propagation + Manager Ticket Bill-To Control

## Context
Reassigning an equipment's bill-to account (`equipment.customer_id`, editable since PR #183) does **not** propagate to existing open tickets on that equipment, and a ticket's `customer_id` is excluded from every PATCH allow-list, so there is no in-app way to correct a ticket's billing customer (WO 816 was fixed by raw DB update on 2026-06-23). The WO PDF bill-to is a live join on `customer_id`, so a stale ticket snapshot prints the wrong account. This plan closes both gaps: (1) when a manager reassigns an equipment's bill-to, offer to bulk-repoint its still-open tickets; (2) give managers a self-serve single-ticket bill-to control on both service and PM tickets.

## Decisions (confirmed with Caleb 2026-06-23)
- **Hard guard everywhere:** never repoint a ticket that has a `synergy_order_number` OR `synergy_invoice_number` set — applies to BOTH the bulk propagation and the manual single-ticket control. A stuck already-keyed ticket still needs a DB fix (rare).
- **PM eligible statuses:** all non-terminal — `unassigned`, `assigned`, `in_progress`, `skip_requested` (excludes `completed`, `billed`, `skipped`).
- **Service eligible statuses:** `open`, `estimated`, `approved`, `in_progress` (excludes `completed`, `billed`, `declined`, `canceled`).
- **Role gating:** manager-only (`RESET_ROLES` = super_admin + manager), mirroring the equipment bill-to control. Coordinators do not get it.
- **Equipment-link consistency:** the single-ticket repoint requires the target customer to match the ticket's linked equipment's `customer_id` (if it has one). This makes the control a "sync the ticket to its equipment's bill-to" tool — exactly the WO 816 case. Inline / equipment-less tickets accept any active customer. (Flag for sign-off — can relax to "any active customer" if Caleb prefers.)
- **No migration** — reuses the existing `customer_id` link on both ticket tables. Both tables already have `customer_id` + `ship_to_location_id`.

## Out of Scope
- A DB trigger cascade from `equipment` → tickets (deliberately app-layer + opt-in, so a reassignment never silently rewrites billing without a manager's say).
- Repointing already-invoiced/ordered tickets (hard-blocked per decision above; still a DB-level fix).
- Synergy write-back of any kind.
- Bulk repoint across multiple pieces of equipment at once (this is per-equipment, triggered by its own reassignment).
- Changing how `equipment.customer_id` reassignment itself works (PR #183 is the established hook point; we only add propagation on top).

## Rounds

### Round 1 — Shared safe-repoint helper + single-ticket bill-to endpoints
**Scope:** A server-side helper that safely repoints one ticket's `customer_id` (validate target customer active, hard-block if Synergy order/invoice # present, enforce equipment-link consistency, clear orphaned `ship_to_location_id`), plus two manager-only endpoints that call it — one for service, one for PM.
**Files:**
- new `src/lib/db/repoint-billto.ts` — `repointTicketBillTo(supabase, { kind: 'service' | 'pm', ticketId, customerId })` returning a typed result (`{ ok: true } | { ok: false; status: number; error: string }`).
- new `src/app/api/service-tickets/[id]/bill-to/route.ts` — `POST`, `RESET_ROLES` only.
- new `src/app/api/tickets/[id]/bill-to/route.ts` — `POST`, `RESET_ROLES` only (PM).
**Acceptance:** A manager `POST`ing `{ customer_id }` to either endpoint repoints a clean ticket (and clears its now-orphaned ship-to); a ticket with a Synergy order/invoice # returns 409; an inactive/nonexistent target returns 422; a target that doesn't own the linked equipment returns 422; a coordinator/tech gets 403.
**Verification:** `npm run build` green; curl/REST-client the four cases against a preview against prod DB (or unit-test the helper's branch logic with a mocked supabase). Confirm guard via a ticket known to have a Synergy #.
**Memory:** Note the shared helper + the hard-block guard semantics; link from `callboard-equipment-billto-propagation.md`.

### Round 2 — Single-ticket bill-to control UI (service + PM detail)
**Scope:** Manager-only "Change Bill-To" control on both ticket detail pages, consuming the Round 1 endpoints. Hidden/disabled (with explanatory text) when the ticket carries a Synergy order/invoice #.
**Files:**
- `src/app/service/[id]/ServiceTicketDetail.tsx` — add the control (customer search combobox reusing the EquipmentForm pattern; gated to `RESET_ROLES`).
- the PM ticket detail page + its client component under `src/app/tickets/[id]/` — same control.
- likely a small shared `BillToControl.tsx` component to avoid duplicating the combobox in two places.
- pass a `canEditBillTo` prop from each page's server component (`RESET_ROLES.includes(role)`).
**Acceptance:** A manager can repoint a clean ticket from the detail page and the bill-to/WO PDF immediately reflects the new account; the control is absent for coordinators/techs; a Synergy-keyed ticket shows the disabled state with a "fix in Synergy / DB" note instead of a live control.
**Verification:** `npm run build` green; browser smoke on preview — repoint WO-style test ticket, confirm WO PDF bill-to changes; confirm hidden for coordinator.
**Memory:** UI entry points + the disabled-when-keyed behavior.

### Round 3 — Equipment reassignment detection + bulk-propagate endpoint
**Scope:** When `equipment.customer_id` changes in the equipment PATCH route, after the update commits, detect eligible still-open tickets (service + PM) still on the OLD customer and return them in the PATCH response. Add a manager-only bulk endpoint that repoints a supplied set of those tickets via the Round 1 helper (re-validating the guard server-side).
**Files:**
- `src/app/api/equipment/[id]/route.ts` — after a successful customer_id change, query eligible candidates and include `{ propagation: { oldCustomerId, newCustomerId, serviceTickets: [...], pmTickets: [...] } }` in the response.
- new `src/app/api/equipment/[id]/propagate-billto/route.ts` — `POST { customer_id, service_ticket_ids, pm_ticket_ids }`, `RESET_ROLES`, loops the helper, returns per-ticket results (updated / skipped-guarded).
**Acceptance:** Reassigning an equipment with N eligible open tickets returns those N (with WO #, status, current customer) and excludes any with a Synergy #; the bulk endpoint repoints exactly the supplied clean tickets and reports any it skipped.
**Verification:** `npm run build` green; reproduce the WO 816 shape on preview (equipment + open ticket on old account), confirm the PATCH response lists it and the bulk endpoint repoints it.
**Memory:** Detection query (eligible statuses + guard) and the response shape.

### Round 4 — Propagation prompt UI in EquipmentForm
**Scope:** After a successful bill-to reassignment, if the PATCH response carries propagation candidates, show a modal: "N open work orders still bill the old account — update them too?" with the per-ticket list and Update all / Keep as-is. On Update, call the Round 3 bulk endpoint. Mirrors the `GeneratePmModal` warn-with-preview pattern.
**Files:**
- new `src/app/equipment/[id]/PropagateBillToModal.tsx`.
- `src/app/equipment/[id]/EquipmentForm.tsx` — on save success, read `data.propagation`; if non-empty, open the modal instead of just `router.refresh()`.
**Acceptance:** Reassigning an equipment that has eligible open tickets pops the modal listing them; choosing Update repoints them (confirmed on the ticket + WO PDF); choosing Keep leaves them; no candidates → silent refresh as today; the modal never lists Synergy-keyed tickets.
**Verification:** `npm run build` green; full browser smoke on preview — reassign, see modal, update, verify tickets moved.
**Memory:** Final shipped entry on `callboard-equipment-billto-propagation.md` flipping it from BACKLOG to SHIPPED, with PR #s.

## Cross-Cutting Concerns
- **Migrations:** none. Reuses `customer_id` (already on both ticket tables; both also have `ship_to_location_id`).
- **Shared modules (dependency order):** Round 1's `repoint-billto.ts` is consumed by Round 3's bulk endpoint — Round 1 must land first. Round 2's optional `BillToControl.tsx` combobox can be reused by Round 4's modal (extract in R2, reuse in R4) or kept separate.
- **Base branch:** local `master` is ~19 commits behind `origin/master`; sync to `origin/master` before branching. Each round = its own feature branch off updated master → PR → merge (Vercel auto-deploys).
- **Preview = prod DB:** no separate dev DB, but this plan has no migration, so previews work without any DB step.
- **Consistency invariant:** repointing a ticket's `customer_id` without matching its linked equipment would create a ticket-vs-equipment billing mismatch — the equipment-link consistency check (Round 1) prevents this; the bulk path is inherently consistent (it repoints tickets TO the equipment's new customer).
- **Rollback story:** no schema change, so rollback = revert the PR. Data side: a wrongly-propagated ticket is itself re-fixable via the Round 2 single-ticket control (back to the prior account, as long as it has no Synergy #).

## Verification (end-to-end)
Reproduce WO 816 on preview: create equipment on customer A with one open service ticket and one open PM ticket (no Synergy #s), plus one billed ticket. Reassign the equipment's bill-to to active customer B → modal lists exactly the two open tickets (not the billed one) → Update → both open tickets now bill to B, ship-to cleared, WO PDFs show B; the billed ticket is untouched. Separately, from a single open ticket's detail page, a manager repoints its bill-to and the WO PDF updates; a coordinator never sees either control.

## History
(empty — populated as rounds ship)
