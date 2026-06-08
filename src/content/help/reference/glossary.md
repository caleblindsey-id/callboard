---
title: Glossary
category: Reference
roles: [super_admin, manager, coordinator, technician]
order: 10
summary: Plain-language definitions of the terms you'll see throughout CallBoard.
last_verified: 2026-06-08
---

## PM (Preventive Maintenance)
Scheduled, recurring service on a customer's equipment — monthly, bi-monthly, quarterly, semi-annual, or annual. PMs are generated in monthly batches and usually billed at a **flat rate**.

## Service ticket
Reactive, one-off repair or diagnostic work — the customer called with a problem. Unlike a PM, it isn't on a schedule and it's billed by time and materials.

## Flat rate vs. Time & Materials
**Flat rate** is a fixed price for the work regardless of hours (how PMs are billed). **Time & Materials** is labor hours × the labor rate, plus parts (how extra and service work is billed).

## Credit hold
A customer is on credit hold when their **AR balance is over their credit limit, or they're past the allowed past-due days**. Work for them is gated and routed to AR for a release/block decision. See [Release or block a credit hold](/help/managers/release-a-credit-hold).

## Synergy Order #
The order number from Synergy that ties a piece of CallBoard work back to the order/invoice in Synergy. It's required to mark a service ticket **billed** and to mark parts **ordered**.

## Synergy Invoice #
The invoice number from Synergy entered on a **PM ticket** after you've exported it and created the invoice. A PM isn't marked **billed** until its Synergy invoice number is on file (one invoice per work order) — proof the work was actually invoiced. See [Bill completed work](/help/managers/billing).

## Machine hours
The reading off the equipment's **hour meter**, entered by the tech when completing a PM (for example, `1247.5`). It tracks how much the machine has run between visits.

## Date code
The stamped **date/lot code** on the machine (for example, `26W15`), entered at PM completion. It's a required field on the work order.

## Lead bonus tiers
Equipment-sale lead bonuses by tier: **Ride-On Scrubber $200**, **Walk-Behind Scrubber $100**, **Hot Water Pressure Washer $100**, **Cold Water Pressure Washer $25**, **Cord Electric $25** (excludes vacuums, fans, and extractors under 10 gallon). PM lead bonus equals the **first PM's flat rate**, and only **monthly, bi-monthly, and quarterly** schedules earn — semi-annual and annual don't. See [Submit a lead](/help/technicians/submit-a-lead).

## ACE labor
Extra labor a tech did on no-charge work that should still count toward their **payout**. It's captured at completion, approved by a manager, and **never appears on the customer's invoice**.

## Backfill
When you set up a PM schedule, CallBoard can generate the **prior months'** PM tickets so the history is complete. It's skipped automatically if the start date is more than three months back, or if you tick "skip backfill."
