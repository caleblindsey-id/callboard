# Handoff — return-to-vendor / restock for parts marked "not used"

**Written:** 2026-09-01, at the end of the feedback #90 fix.
**Status:** scoping only. Nothing here is built. Read "What already exists" first — a
chunk of the groundwork landed with #90 and you should not redo it.

---

## Why this exists

Ken Crummie (manager) asked, on WO #1396: *"Jeo marked 'part not used' for the Scrub
motor. what happens to the part in call board?"*

The honest answer at the time was **nothing**. Marking a part not-used wrote three
fields onto the `parts_requested` entry (`wo_excluded_at` / `wo_excluded_by` /
`wo_exclude_reason`) and stopped there. That correctly kept the part off the invoice,
but it also removed the part from the tech-facing banner and from the office's
`/parts-queue/not-on-work-order` report, and **no screen anywhere read the reason
back**. A $1,372.30 Tennant scrub motor was ordered, received, collected by the tech
on 8/5, marked "Found wiring issues" on 8/14 — and from that moment the app showed it
as an ordinary "Received" part, indistinguishable from the four parts on the same PO
that were actually fitted.

Feedback #90 fixed the **visibility** half of that. It did not touch the **physical**
half, which is the real question Ken was circling: *the motor is somewhere. Where? Who
is sending it back? Did we get the money back?* That is this document.

## What already exists (do not rebuild)

Shipped in the #90 branch:

| Piece | Where |
|---|---|
| `partsMarkedNotUsed()` — the fulfilled-and-excluded predicate, the exact complement of `partsMissingFromWorkOrder`'s exclusion filter | `src/lib/parts.ts` (tested in `parts.test.ts`) |
| `getPartsMarkedNotUsed()` — cross-ticket scan, PM + service, **includes billed tickets** | `src/lib/db/parts-queue.ts` |
| "Marked Not Used" table — WO, customer, tech, part, value, reason, who/when | `/parts-queue/not-on-work-order` |
| "Not used — <reason> · marked <date>" line + `NOT USED` chip on the part row | `PartsSection.tsx` (service), `PmPartsSection.tsx` (PM) |
| Manager-only **Undo**, clearing the three keys so the part returns to the billable lists | both sections above |

So the office can now *see* every not-used part and its reason, and a manager can
reverse a mis-tap. There is still no field anywhere that records what physically
happened to the part.

## The live problem, sized

Seven parts across five work orders, **$4,914.61**, as of 2026-09-01 (prod):

| WO | Type | Part | Value | Reason | Marked |
|---|---|---|---|---|---|
| 790 | service | 9017807 DRIVER MOTOR | $3,483.40 | "replacement" | Tamara Ridlehoover, 8/6 |
| 1396 | service | 24v elec scrub motor | $1,372.30 | "Found wiring issues" | Jeovany Delpino, 8/14 |
| 1233 | PM (billed) | DRIVE PLATE COMPLETE ASSY | $57.91 | "PER JEFF" | Tiffaney Browning, 8/26 |
| 870 | PM | Squeegee | $1.00 | "Flip blade" | Jacob Essmon, 9/1 |
| 870 | PM | Squeegee | $0.00 | "Flip blade" | Jacob Essmon, 9/1 |
| 880 | PM (billed) | Squeegee kit | $0.00 | "Wrong parts" | Bob Brashears, 7/30 |
| 880 | PM (billed) | Skirts | $0.00 | "Only received one skirt but machine requires two." | Bob Brashears, 7/30 |

Two observations that should shape the design:

1. **The value is concentrated.** Two motors are 99% of the dollars. Whatever gets
   built has to work well for the $3,483 motor; the $0.00 squeegees mostly need to not
   generate busywork.
2. **The reasons are already telling you the disposition,** in free text. "Wrong
   parts" and "Only received one skirt" are vendor-return cases. "Flip blade" and
   "Found wiring issues" are back-on-the-shelf cases. "PER JEFF" is unclassifiable.
   A structured reason/disposition picker would earn its keep immediately — but see
   the open questions before designing one.

## Open questions — ask Ken and the parts desk BEFORE designing

These are process facts nobody in the codebase knows. Do not guess at them; the whole
feature shape depends on the answers.

1. **What actually happens today, off-system?** When Jeovany decides not to fit the
   motor, does he drive it back to the shop? Does it sit in the van? Does anyone tell
   Allison or Elijah? Is there a paper form? Find the existing informal process and
   digitize *that*, rather than inventing one.
2. **Vendor return vs. restock — who decides, and on what?** Tennant presumably has a
   returns window and a restocking fee. Is a $57.91 drive plate ever worth returning,
   or does it just go on the shelf? Is there a dollar threshold?
3. **Does a returned part come back as a credit against the original PO,** or as a
   standalone credit memo? This determines whether the workflow keys on `po_number`
   (already on every part entry) or needs its own reference.
4. **Who owns the chase?** The warranty-credit queue is owned by the office. Is a
   parts return the same people, or the purchasing agents?
5. **What does Synergy already know?** If a return is keyed in Synergy anyway, this
   may be a read-only reconciliation view (like the PO due-date lookup) rather than a
   write workflow. Check `synergy_po_lines` and whether credits/RMAs sync.
6. **Restock and inventory.** `qty_on_hand` / `qty_on_po` are read from Synergy at
   triage time. If a part physically returns to the shelf, does CallBoard need to do
   anything, or does Synergy handle it when the part is received back?

## Design options

### A. Extend the part entry (smallest)

Add `return_disposition` ('vendor' | 'stock' | 'scrap'), `return_reference` (RMA /
credit memo #), `returned_at` / `returned_by`, `credit_expected`, `credit_received_at`,
`credit_amount` to the `parts_requested` JSONB entry, alongside the existing
`wo_excluded_*` keys. Surface them as an expandable panel on the "Marked Not Used"
row.

*Pros:* no migration, no new table, reuses the addressing and write path #90 already
proved. Ships in a day.
*Cons:* the worklist has to full-scan both ticket tables to find open returns — see the
PostgREST landmine below. Aging queries ("returns older than 30 days") are done in JS
over every ticket, which is fine at 1,600 tickets and bad at 10,000.

### B. A `part_returns` table (properly indexed)

One row per returned part, FK to the ticket + the part's `requested_at` (the stable
identity `usedLineMatchesRequest` already relies on — **not** the array ordinal, which
is only stable within a ticket). Mirrors migration `119_warranty_credit_tracking.sql`
almost field for field.

*Pros:* real indexes, a cheap aging clock, a real worklist, and a natural home for a
dashboard count. Reporting stays cheap forever.
*Cons:* a migration — which in this repo must be **applied by hand** to prod in the
same change (see AGENTS.md; migration 073 shipped unapplied and 500'd every tech-lead
submission). Plus a second source of truth to keep in sync with the JSONB stamp.

### C. Fold it into the existing warranty-claims queue

A vendor return and a warranty claim are the same lifecycle: file with the vendor, get
an RMA, wait, log the credit. `/warranty-queue` already renders exactly this.

*Pros:* one mental model and one screen for the office.
*Cons:* warranty tracking is per-*ticket* (`service_tickets.warranty_*`), and a part
return is per-*part* — a ticket can have one returned part and five fitted ones. The
grain is wrong, and forcing it would damage the warranty flow. Probably a trap, but
worth 20 minutes to confirm before discarding.

**Recommendation:** start with **A**, structured-disposition only — a picker plus a
free-text reference, no credit tracking — and see whether the branch actually fills it
in. The current free-text reasons suggest they will. Move to **B** the moment anyone
asks "which returns are still open?", because that question is what the JSONB scan
cannot answer cheaply. Do not build credit tracking until question 3 above is
answered; guessing wrong there means modelling money that never flows that way.

## Landmines specific to this area

- **`parts_requested` is positionally addressed and append-only.** The Parts Queue
  references a part by its array ordinal (`part_index`). Never splice an entry — soft-
  flag in place. This already caused feedback #64 ("part_index out of range").
- **PostgREST silently caps a response at 1000 rows.** `pm_tickets` is already at
  1,066. The first cut of `getPartsMarkedNotUsed()` dropped WO 870 entirely with no
  error anywhere — it was only caught by comparing the page against a hand-written SQL
  count. Any new cross-ticket scan must page (`fetchAllPages` in
  `src/lib/db/parts-queue.ts`) or filter server-side. **Verify any new list against a
  direct SQL count before believing it.**
- **Soft deletes.** `deleted_at` is not filtered by RLS. Every multi-row read needs
  `.is('deleted_at', null)`; `npm test` enforces it for direct reads but **not** for
  writes, embedded joins, or `.rpc()`. See AGENTS.md.
- **Letting a tech write a new field takes three layers,** not one: the UI gate,
  `TECH_ALLOWED_FIELDS` on the route, and the `...(isStaff ? {} : {})` submit spread —
  miss the third and the field is silently dropped with a green build.
- **Techs are blocked by `TECH_ALLOWED_API_PATTERNS` in `src/proxy.ts`** before the
  route ever runs. A new endpoint a tech must call needs an entry there or it returns
  "Forbidden" no matter how permissive the route and RLS are (feedback #61).
- **Migrations are applied manually.** Adding a file under `supabase/migrations/` puts
  it in no database. Apply it via the Supabase MCP `apply_migration` (not
  `execute_sql`, or `npm run check:migrations` won't see it) in the same change.

## Where to start

1. Answer the six questions above with Ken. That is the whole first session.
2. Re-run the sizing query — the seven rows will have moved:
   ```sql
   select t.work_order_number, t.status, p->>'description' d,
          (p->>'quantity')::numeric * coalesce((p->>'unit_price')::numeric,0) value,
          p->>'wo_exclude_reason' reason, p->>'wo_excluded_at' at
   from service_tickets t, jsonb_array_elements(t.parts_requested) p
   where t.deleted_at is null and p ? 'wo_excluded_at'
   union all
   select t.work_order_number, t.status, p->>'description',
          (p->>'quantity')::numeric * coalesce((p->>'unit_price')::numeric,0),
          p->>'wo_exclude_reason', p->>'wo_excluded_at'
   from pm_tickets t, jsonb_array_elements(t.parts_requested) p
   where t.deleted_at is null and p ? 'wo_excluded_at'
   order by value desc;
   ```
3. Close the loop with Ken on the two motors (WO 790, WO 1396) specifically — those
   are real money sitting somewhere right now, and finding out what happened to them
   will teach you the actual process faster than any meeting.
