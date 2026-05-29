---
title: Create a service ticket and send an estimate
category: Office
roles: [super_admin, manager, coordinator]
order: 10
summary: Open a repair ticket, build an itemized estimate, and send it to the customer for approval.
last_verified: 2026-05-28
---

When a customer calls with a problem, you open a service ticket, optionally build an estimate, and send it to them to approve before work begins.

## Part 1 — Create the ticket

1. Tap **Service Tickets**, then **+ New Service Ticket**.
2. **Customer** *(required)* — search by name or account number. If the customer is on **credit hold**, you'll see a warning: the ticket will go to AR for approval and work stays gated until AR releases it.
3. **Ship-To Location** — if the customer has ship-to addresses, pick one. It pre-fills the service address and filters the equipment list.
4. **Equipment** *(required)* — pick the machine. If none is on file, an amber note appears and you register it inline (at least a **Make or Model** is required). A serial that already exists for the customer will be flagged.
5. **Ticket details:**
   - **Type** — *Inside (Shop)* or *Outside (Field)*. Outside tickets add a service-address section.
   - **Billing Type** — Non-Warranty, Warranty, or Partial Warranty.
   - **Priority** and **Labor Rate** (Standard / Industrial / Vacuum — used for estimate math).
   - **Problem Description** *(required)*.
   - **Diagnostic Fee** — optional, if one was already invoiced in Synergy.
6. **Contact** *(required)* — a name, plus at least an email **or** phone. CallBoard pre-fills from the equipment, ship-to, or customer contact when it can.
7. **Assigned Technician** — optional; can be left unassigned.
8. Tap **Create Service Ticket**.

## Part 2 — Build and send the estimate

Open the new ticket. While it's **Open**, build the estimate:

- **Estimated Labor Hours** — multiplied by the labor rate.
- **Parts** — add each line with quantity, price, and a warranty checkbox (warranty parts count as $0). Each row has a **Request Part** button that drops it into the [Parts Queue](/help/office/order-parts) so sourcing can start right away.
- **Diagnosis Notes** — **these are shown to the customer** on the approval page. Keep internal commentary out.

The running **Estimate Total** updates as you go. **Estimates under $100 are auto-approved** on submit; $100 and over wait for approval.

Tap **Submit Estimate**, then send it:

- **Email Estimate** — needs a contact email. It sends the customer a link to a private approval page that's valid for **7 days**. After it expires, use **Resend Approval Link** for a fresh one.
- **Download Estimate PDF** — for manual sharing.

The customer signs and approves (or declines) on that page. A manager can also approve, decline, or **Request More Info** (which bounces it back to the tech with a note).

## Gotchas

- **Diagnosis Notes are customer-visible.** Don't put internal notes there.
- **The approval link expires after 7 days.** Resend if the customer is slow.
- A **credit-hold** customer routes the ticket to AR — work stays gated until the hold is released. See [Release or block a credit hold](/help/managers/release-a-credit-hold).
