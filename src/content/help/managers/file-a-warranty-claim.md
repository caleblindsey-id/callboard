---
title: File a warranty claim and log the vendor credit
category: Managers
roles: [super_admin, manager, coordinator]
order: 55
summary: Verify coverage, file the claim, and log the vendor credit so covered repairs stop short of billing the customer for parts the manufacturer owes.
last_verified: 2026-08-26
---

Warranty is a review lifecycle, not a field a tech sets at intake. A tech flags a repair they think is covered; you verify (or deny) it on the ticket; the ticket still completes at full price either way; and once it's verified, you file the claim, chase the vendor, and log the credit through the **Warranty Claims** queue. CallBoard will not let a warranty ticket be billed until that lifecycle is settled.

## Who does this

Managers and coordinators. Technicians only flag the repair and complete the job normally: see [Flag a warranty repair](/help/technicians/flag-a-warranty-repair) and [Complete a service ticket](/help/technicians/complete-a-service-ticket).

## Step 1: a tech flags it

Any time from when the ticket is assigned through when it's completed, a tech (or you) can flag a ticket from the **Warranty** box on the ticket page, with a note explaining why (serial number, purchase date, the part that was recently replaced). The ticket moves into **To verify** and keeps working normally: flagging doesn't pause anything.

## Step 2: verify or deny on the ticket

Verification happens on the ticket itself, not in the queue. Open the **Warranty Claims** queue (Menu → **Queues** → **Warranty Claims**) and tap **Review on ticket** on any card in **To verify**, or open the ticket directly and find the **Warranty** box.

Tap **Review**, then record the verdict:

- **Verified covered**: check **Labor covered** if labor is included, tick each covered part individually, and set the **Vendor** and the **Vendor labor rate** ($/hr) if labor is covered. An optional decision note is yours to leave for the record.
- **Denied**: a reason is required. The ticket goes back to billing normally, with no further warranty steps.

The tech's note stays visible on the ticket, and either verdict can be changed later by tapping **Change verdict**.

**The job still completes at full price no matter the verdict.** The tech logs their real hours and parts as usual; nothing about coverage changes what goes on the ticket. `billing_amount` is the full-price total the vendor claim is built from, and it never gets touched by warranty.

## Step 3: file the claim

Once a ticket is verified AND completed, it lands in **To file**. Tap **File claim** on the card and fill in:

- **Vendor** (the manufacturer)
- **Claim / RMA #** (their reference)
- **Vendor labor rate** ($/hr, if labor is covered; carries over from the verdict but can be corrected here)
- **Expected credit**

CallBoard prefills **Expected credit** from the covered parts and labor: covered parts at their Synergy cost, plus covered labor at hours worked times the vendor labor rate. If any covered part has no cost on file, the suggestion says so and the number is a floor, not the full expected credit: check it before filing.

Tap **Mark filed**. The card moves to **Awaiting credit** and its age pill restarts, because from here what matters is how long the vendor has had it.

## Step 4: chase and log the credit

Claims in **Awaiting credit** also show up in the weekday morning digest under **Warranty credits to chase**, aged from the day they were filed, so a claim that goes quiet resurfaces on its own without you having to remember to check. (Claims still sitting in **To verify** show up too, under **Warranty reviews to verify**, so an unreviewed flag doesn't stall silently either.)

When the credit comes back:

1. Tap **Log credit** on the card.
2. Enter the **actual** credit for each covered part and for labor, individually. The "Expected" figure sits next to each field for reference, but the vendor's actual line-item credit is what gets recorded.
3. Tap **Mark credit received**.

Logged one by mistake? Tap **Undo credit** and confirm. The claim drops back to **Awaiting credit**, the amounts clear, and the filing record (vendor, claim #) stays intact.

## The anomaly: billed, never claimed

This is the anomaly, not the normal path. It means a verified ticket was already invoiced to the customer with no vendor claim ever filed against it. The revenue is booked and the credit will never arrive unless someone chases it. Treat these as the most urgent cards on the page; the action is the same **File claim** as Step 3.

## Billing a warranty ticket

A warranty ticket goes through the normal billing flow with one extra gate, and it can be blocked for either of two reasons:

> Warranty review pending — record the coverage verdict before billing this ticket.

> Vendor credit not yet received — log the warranty credit before billing this ticket.

The first clears once you record a verdict (verified or denied). The second clears once the credit is logged in Step 4. Clear either from the ticket or the **Warranty Claims** queue, not from the billing screens themselves.

## What the customer pays

Once a ticket is verified, the amounts you see on **Billing** and in the **Invoiced** archive switch from the full claim total to what the customer actually pays: covered parts (and, if labor is covered, labor plus the trip charge) come off the full-price total. When the two differ, the claim value shows as a smaller secondary line so you can still see what the vendor owes. The final work-order PDF mirrors this: covered lines print at $0 and the total is the customer's net amount, not the claim amount.

## Where the numbers land

The **Report** button at the top of the **Service Tickets** page has a **Warranty credit recovery** card: claims filed, credits received, dollars actually recovered, dollars still outstanding, and the median days from filing to credit. The **Credit received** card on the queue itself shows the same recovered-vs-expected comparison per ticket, flagging any shortfall. Both figures survive billing, so the history stays accurate.

## Gotchas

- **A credit cannot be logged from the ticket page.** It only happens on the **Warranty Claims** queue, or the billing gate stays shut.
- **Undo clears the amount, not the filing.** Undoing a credit does not un-file the claim.
- **The customer never sees any of this.** The verdict, vendor, claim number, and credit amounts stay internal; the customer only ever sees the net amount they owe.
- **Billing Type is retired.** Tickets completed before this lifecycle shipped still carry their old Billing Type (Non-Warranty, Warranty, Partial Warranty) for reference on the billing and invoiced screens, labeled as legacy, but it no longer drives anything. Every ticket completed today goes through the flag/verify lifecycle above regardless of what that old field would have said.
