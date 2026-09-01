---
title: What's new
category: Reference
roles: [super_admin, manager, coordinator, technician]
order: 30
summary: Recent changes and additions to CallBoard.
last_verified: 2026-09-01
---

The latest updates to CallBoard, newest first.

## September 2026

- **Export several service tickets at once.** The service **Ready to Export** list now has checkboxes and a **Select all**, matching the PM list above it. Tick the tickets you're billing and tap **Export Selected** — they come down as one PDF with a page per work order, and all move to **Awaiting Invoice #** together. Exporting a single row on its own still works the same way. See [Bill completed work](/help/managers/billing).
- **Fix an ACE labor entry instead of rejecting it.** When a tech's ACE entry has the right idea but a wrong number, **Edit** it in place — hours, rate type, and reason are all editable from the **ACE Review** tab and from the **ACE Labor** card on the ticket. The entry stays in the queue for approval, so nobody waits on a resubmission. Rejecting still works for entries that shouldn't be paid at all, and editing a rejected entry puts it back in the queue. Approved and paid entries stay locked. See [Run tech payouts](/help/managers/tech-payouts).

## August 2026

- **Bill completed work faster.** Key the Synergy order the day work finishes — exporting a work order is never blocked by a missing PO on either PM or service tickets; the PO (when the customer requires one) and the Synergy invoice # now both gate **Mark Billed** instead. A new **Billing Chase** worklist replaces separate PM/service PO-chasing with one list covering both, plus a Synergy order # reason — log each contact attempt right on the row. A nightly check also watches Synergy for orders it shows as invoiced and pre-fills the invoice number with a **Synergy shows invoiced — confirm** pill, so the office only has to confirm, not re-key. See [Bill completed work](/help/managers/billing) and [Work the Billing Chase list](/help/managers/billing-chase).
- **Warranty is now a review lifecycle, not a billing type.** Techs flag a repair for warranty from a **Warranty** box on the ticket, any time between assignment and completion, with a note. The office verifies coverage there too: labor covered, per part covered, vendor, and vendor labor rate, or denies with a reason. Every ticket completes at full price regardless of the verdict; once verified, the claim moves through the **Warranty Claims** queue (file, chase, log the credit) and the vendor credit is now reconciled line by line against the actual covered parts and labor. Billing unlocks once the verdict is recorded and, if covered, the credit is logged, and the customer's invoice shows the net amount after coverage. See [File a warranty claim and log the vendor credit](/help/managers/file-a-warranty-claim) and [Flag a warranty repair](/help/technicians/flag-a-warranty-repair).
- **The morning digest now chases warranty reviews too.** A new **Warranty reviews to verify** section lists tickets a tech flagged that nobody has verified or denied yet, alongside the existing **Warranty credits to chase** section for claims filed with a vendor that haven't been credited back.

## June 2026

- **PM billing now has a Mark Billed step** — exporting a PM billing PDF no longer marks the tickets billed. Exported PMs move to an **Awaiting Invoice #** section on the Billing page; enter each work order's **Synergy invoice number**, then tap **Mark Billed**. Exported something by mistake? **Un-export** sends it back. See [Bill completed work](/help/managers/billing).

## May 2026

- **Help & Guides** — CallBoard now has this built-in manual. Find it any time from **Help & Guides** at the bottom of the menu, browse by role, or search across every guide.

---

*Spotted something missing or wrong in a guide? Use the **Send Feedback** button in the bottom-right corner of any screen.*
