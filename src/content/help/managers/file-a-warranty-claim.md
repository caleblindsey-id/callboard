---
title: File a warranty claim and log the vendor credit
category: Managers
roles: [super_admin, manager, coordinator]
order: 55
summary: Work the Warranty Claims queue so covered repairs get their vendor credit before the customer is billed.
last_verified: 2026-08-26
---

When a repair is covered under warranty, the customer is not charged for it. The branch still carries the cost of the parts until the manufacturer credits them back. **Warranty Claims** is where that credit gets chased, and CallBoard will not let you bill a warranty ticket until the credit is recorded.

That block is the whole point of the queue. Billing a warranty ticket before the credit lands closes the job while the money is still outstanding, and nothing afterward goes looking for it.

## Who does this

Managers and coordinators. Technicians never see this queue. Their only part is choosing the right **Billing Type** when they complete the job (see [Complete a service ticket](/help/technicians/complete-a-service-ticket)).

## The three billing types

Set at intake, changeable any time from the ticket's **Assignment** card, and confirmed by the tech at completion:

- **Non-Warranty** billed normally. (The billing screens label this one **T&M**.)
- **Warranty** the customer is billed **$0**. No labor, no parts, no trip charge.
- **Partial Warranty** the customer is billed for labor and the trip, plus only the parts *not* ticked as warranty covered on the completion form.

Warranty and partial warranty tickets skip the estimate entirely. Instead of **Build Estimate**, the tech gets a single **Start Work** button, because there is nothing to quote the customer.

## Open the queue

Menu → **Queues** → **Warranty Claims**. The dashboard also shows a **Warranty claims to work** card whenever anything needs attention; it disappears when the queue is clear.

The page lists every claim as a card, oldest first, grouped into four sections. The coloured pill on the right is the age: green under a week, yellow at one to two weeks, orange up to a month, red past 30 days. Use the search box to find a claim by customer, equipment, serial, vendor, claim number, or WO number.

## Section 1: To file

Warranty work is finished and no claim has been filed yet.

1. Tap **File claim** on the card.
2. Fill in **Vendor** (the manufacturer), **Claim / RMA #** (their reference), and **Expected credit** (what you expect back, in dollars).
3. Tap **Mark filed**.

The card moves down to **Awaiting credit**, and its age pill restarts from today, because from here on what matters is how long the *vendor* has had it.

You can file with only some of the fields filled in, but the expected credit is what feeds the outstanding total on the service operations report, so it is worth entering.

## Section 2: Awaiting credit

The claim is with the vendor and you are waiting on the money. These also appear in the weekday morning digest under **Warranty credits to chase**, so a claim that goes quiet resurfaces on its own.

When the credit comes through:

1. Tap **Log credit**.
2. Enter the **Credit received** amount (and correct the vendor or claim number if they changed).
3. Tap **Mark credit received**.

## Section 3: Credit received

The credit is recorded and the ticket is now free to bill. Nothing else is required here.

Logged a credit by mistake? Tap **Undo credit** and confirm. The claim drops back to **Awaiting credit** and the amount is cleared. The filing record stays intact.

## Section 4: Billed, never claimed

This one is not part of the normal flow. It means a warranty ticket was **already invoiced to the customer** with no vendor claim ever filed against it. The revenue is booked and the offsetting credit will never arrive unless somebody chases it.

Treat these as the most urgent rows on the page. The action is the same **File claim** as section 1, and filing removes it from the queue.

## Billing a warranty ticket

Warranty tickets go through the normal billing flow, with one extra gate. On **Billing** → **Awaiting Invoice #**, any warranty ticket without a logged credit shows an amber **Awaiting vendor credit** flag and cannot be selected. Attempting it anyway returns:

> Vendor credit not yet received — log the warranty credit before billing this ticket.

Clear it by logging the credit on this page. The full order of operations is: complete the work, file the claim, log the credit, export, key the Synergy invoice number, then **Mark Billed**.

## Where the numbers land

The **Report** button at the top of the **Service Tickets** page has a **Warranty credit recovery** card: claims filed, credits received, dollars actually recovered, dollars still outstanding, and the median days from filing to credit. Those figures survive billing, so the history stays accurate.

## Gotchas

- **A credit cannot be logged from the ticket page.** It only happens here, or the billing gate stays shut.
- **Undo clears the amount, not the filing.** Undoing a credit does not un-file the claim.
- **Partial warranty is still gated.** It is billable work, but it goes through the same credit requirement as full warranty.
- **The customer never sees any of this.** Vendor, claim number, and credit amounts stay internal.
