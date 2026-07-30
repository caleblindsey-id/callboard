# Parts Shipping: Customer Freight Charge + Priority Shipping Request

**Feedback #80** — Mike Jennings (technician), 2026-07-21, on `/service/2ff150d6-1a92-4e7a-979d-11312a5c29d0` (WO-1132).

> Need line to charge customer shipping for parts we have to order. On WO-1132 we're
> paying minimum $25 to have these brushes shipped to us.
>
> Also have option or box to note for priority shipping. Some customers want NDA or
> 2nd day air.

## Problem

Two gaps in the parts-ordering flow, both confirmed against prod (`Scheduler Program`):

1. **No way to pass freight through to the customer.** WO-1132 is `status='billed'`:
   2× "Roller brush assembly, red r75" @ $298.87 on Karcher PO 54761, and zero
   dollars of freight anywhere on it. This is not a one-off — a query across
   *every* service and PM ticket ever found **zero** with a shipping or freight
   line in `parts_used` / `additional_parts_used`. There is no workaround in use.
   The branch has eaten 100% of inbound freight to date.

2. **No way to request a shipping speed.** A customer who wants next-day-air or
   2nd-day has nowhere to say so, so the buyer placing the PO defaults to ground.

Synergy already expects freight as a line: `products` carries
`205002101 — SHIPPING` at `unit_price = 0.00`, `unit_cost = 0.00` (a $0 price
means it is meant to be typed per-use). Its $0 cost also means the 15% margin
floor never fires on it — `toCost()` in `margin.ts` treats `<= 0` as unknown.

## Design decisions

Confirmed with Caleb before implementation:

| Decision | Choice | Why |
|---|---|---|
| Charge model | Own charge line (ticket column), **not** a `parts_used` line | Immune to the completion-form autosave that PUTs `parts_used` wholesale; mirrors the existing `trip_charge` / `diagnostic_charge` pattern |
| Entry point | Parts Queue **and** ticket detail, editable until billed | Quoted freight at PO time is often corrected when the vendor invoice arrives with the part |
| Method scope | Per-part, on the request | Parts on one ticket can come from different vendors on different POs |
| Ticket types | Service **and** PM | Both already have `trip_charge` and the parts-request flow; asymmetry is the drift AGENTS.md warns about |
| Adoption | Non-blocking freight prompt on `mark_ordered` | The field's absence is why $0 has ever been billed; a field alone changes nothing |

## Data model

### Migration `148_shipping_charge.sql`

Mirrors `105_trip_charge.sql`:

```sql
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS shipping_charge numeric CHECK (shipping_charge >= 0);
ALTER TABLE pm_tickets      ADD COLUMN IF NOT EXISTS shipping_charge numeric CHECK (shipping_charge >= 0);
```

`NULL` = no freight charged. Flat dollars rather than qty × rate (the shape
`trip_charge_qty` uses) because freight is genuinely variable per shipment —
there is no per-unit rate to multiply.

### Migration `150_parts_queue_shipping_charge.sql`

Adds `shipping_charge` to the `parts_order_queue` view. Needed because the
mark-ordered prompt has to know whether freight was already recorded (or it
re-prompts on every part of the same PO), and because the buyer needs to see the
current number to correct it. Kept separate from 149 rather than folded in, so
the repo and the database never disagree about what an already-applied migration
contained — the same reason this view already has eight amending migrations.

### Migration `149_parts_queue_shipping.sql`

Two mechanical recreations:

- **`fn_update_parts_queue`** (rebased on `145`) gains `shipping_charge` in both
  the service and PM `UPDATE` branches, guarded with the same
  `WHEN p_update_payload ? 'key'` pattern as `synergy_order_number`. Required:
  the function has a hard-coded column list, so without this the ticket-level
  write from Parts Queue silently does nothing.
- **`parts_order_queue`** view (rebased on `147`) projects `shipping_method` and
  `shipping_note` out of the `parts_requested` JSONB element, exactly as `070`
  did for `vendor_code`.

### `PartRequest` JSONB — no migration

```ts
shipping_method?: 'standard' | 'second_day' | 'next_day'
shipping_note?: string
```

Absent = standard. Legacy rows read correctly with no backfill.

## Components

### `src/lib/shipping.ts` (new)

Single source of truth for the method list, display labels, the
`isPriorityShipping()` test, and `normalizeShippingCharge()` validation —
consumed by every route, PDF, and component that touches shipping. This
codebase has been bitten repeatedly by duplicated predicates drifting (see the
comment block in `src/lib/parts.ts` on `isPartOutstanding`); one tested module
prevents a repeat. Unit tests in `src/lib/shipping.test.ts`.

### The charge — office-owned end to end

Techs never write it: `shipping_charge` goes in `STAFF_ALLOWED_FIELDS`, not
`TECH_ALLOWED_FIELDS`.

- **Parts Queue** — new `set_shipping_charge` action on
  `api/parts-queue/update`, a near-copy of the existing `set_synergy_order`
  branch: ticket-level, manager-only, through `fn_update_parts_queue` with the
  optimistic lock and 409-on-conflict.
- **Ticket detail** — staff-editable, blocked once the ticket is `completed` or
  `billed` (409 with "Reopen the ticket to change it").

  Narrower than the "editable until billed" this spec originally called for, and
  the reason is `billing_amount`: it is computed once, server-side, at
  completion. Accepting a freight edit after that would store a number no total
  anywhere reflects — the column would say $25 while the PDF, the export, and
  the invoice all disagreed. Reopening re-runs the completion math and picks the
  new figure up correctly.

  Not a practical constraint in the normal flow: parts must be *received* before
  a service ticket can complete, and the vendor's freight lands with the goods,
  so the number is knowable well before completion. The mark-ordered prompt
  exists to make sure it is actually captured there.
- **Billing math** — added into `finalBillingAmount` in the service complete
  route and into `computePmBilling`'s formula, in the same position as
  `tripCharge`, including the `billingType === 'warranty' → 0` rule. Both
  `computePmBilling` callers (`tickets/[id]/complete` and
  `create-equipment-from-lead`) pass the new param.
- **Estimate** — deliberately **NOT** part of `estimate_amount`, mirroring the
  diagnostic fee, which is excluded for exactly the same reason.

  This reverses the initial plan (which folded it into `estimate_amount`
  alongside the trip charge) after implementation exposed two problems:

  1. **Staleness.** The estimate recompute only fires when an estimate *input*
     changes (`estimate_parts`, `estimate_labor_hours`, `labor_rate_type`, or
     the transition to `estimated`). A later freight edit — the normal case,
     since freight arrives with the PO — would leave `estimate_amount` stale
     while the estimate PDF still derived its trip-charge line by subtracting
     from it. The printed breakdown would stop reconciling.
  2. **Rewriting an approved figure.** Freight is discovered *after* the
     customer approves. Folding it in would silently change the number they
     agreed to.

  Instead both estimate surfaces (the PDF and `/e/[token]`) add it as a
  display-time line on top of `estimate_amount`, the same treatment
  `estimateDiagnosticLine` already gets. The in-app estimate *builder* shows no
  shipping line at all, since its preview mirrors `estimate_amount` exactly.

### The method — tech-requested, office-read

Four places a `PartRequest` is born, all of which must carry the field:

1. the service ticket add-part form (`PartsSection.tsx` — Mike's page),
2. `EstimateSection`'s per-line Request button,
3. `PmPartsSection`'s draft request,
4. the bulk "Add Estimate Parts to Queue" promote.

Surfaced to the buyer as a badge on the Parts Queue row (ordering table + Review
table + every mobile card) and in full text in the expanded row detail, so a
rush request is visible at the moment someone keys the order.

**Not** added to the pick-list PDF, despite the initial plan. That sheet covers
the To-Pull tab — parts coming off our own shelf, which never ship — so a
shipping column there would be pure noise on the one document whose job is to
send someone to a bin.

### Freight prompt on mark-ordered

When the office marks a part `ordered` and the parent ticket has no
`shipping_charge` yet, prompt for the freight amount. **Non-blocking** — the
order proceeds whether or not a number is entered. A hard gate would stall
ordering on stock parts and warranty jobs that carry no freight; the goal is to
put the question in front of the buyer at the one moment they are looking at
the vendor's freight quote.

## Customer-facing surfaces

A `Shipping` row in the Charges table plus a summary line, next to Trip Charge:

- `src/lib/pdf/service-work-order-template.tsx`
- `src/lib/pdf/work-order-template.tsx` (PM)
- `src/lib/pdf/estimate-template.tsx`
- `src/app/e/[token]/page.tsx` (customer approval page)
- the ticket-detail billing/estimate breakdown in `ServiceTicketDetail.tsx`
- the billing preview the coordinator reads while keying Synergy

### Tax

Freight is grouped with trip charge as **non-taxed**. The rule in `src/lib/tax.ts`
is parts-only ("labor, trip charge, and diagnostic fee are non-taxable").

Flagged rather than decided silently: separately-stated freight on taxable goods
is often taxable in AL. The exposure is cosmetic — `computePartsTax` is
display-only and Synergy applies the authoritative tax when the invoice is
keyed. Revisit if the office reports invoice mismatches.

## Migration application

Per AGENTS.md, both migrations are applied to the target database in this same
change via the Supabase MCP `apply_migration` (never `execute_sql`, which
`check:migrations` cannot see), bracketed with before/after counts, followed by
`npm run check:migrations`. Both are additive and safe to land ahead of the code.

## Out of scope

- Backfilling freight onto already-billed tickets. WO-1132 is `status='billed'`
  and its invoice is keyed; correcting it is a Synergy-side credit, not a
  CallBoard change.
- Vendor freight *cost* tracking / reconciliation against `a80vm.FreightCode`.
  This spec is about what the customer is charged, not what we paid.
- Making the charge mandatory. Deliberately a prompt, not a gate.
