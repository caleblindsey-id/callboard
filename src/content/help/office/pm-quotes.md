---
title: Quote a PM before the work starts
category: Office
roles: [super_admin, manager, coordinator]
order: 70
summary: Build a priced quote across PM work orders, send it for customer approval, and capture their PO before a tech starts.
last_verified: 2026-08-20
---

Some accounts will not authorize scheduled maintenance until they have a written price, usually because their AP process needs a PO cut against it. A **PM quote** gives them that document, captures their approval and PO number, and holds the work until they say yes.

This is for **PM work orders only**. Service tickets already have [estimates](/help/office/create-a-service-ticket).

## Build a quote

1. Go to **Preventive Maintenance** and find the work orders you want to quote.
2. Tick the checkbox on each row. One quote can cover several work orders.
3. In the action bar that appears at the top, tap **Quote**.

The quote lands in **PM Quotes** as a draft, numbered `Q-1000` and up.

Two rules the board enforces when you build one:

- **All selected work orders must belong to the same customer.** A quote is one customer's document.
- **Every work order needs a flat rate on its PM schedule.** Time and materials or contract schedules have no quotable number, so they are rejected by work order number rather than printed at $0.00.

Prices are **snapshotted** when you build the quote. If someone later edits the flat rate on the PM schedule, the quote still shows, and the customer still owes, the price they were given.

## Send it

Open **PM Quotes** in the sidebar. On the draft's row:

- **PDF** downloads the quote to send yourself.
- **Mark Sent** records that the customer has it, and generates the approval link.

Once it is sent, a **Link** action appears. That copies the customer's approval URL, which you can paste into an email. The link is good for **7 days**.

CallBoard does not email the quote for you yet. Send the PDF or the link from Outlook.

## What the customer sees

The link opens a plain page with no login: the work orders, equipment and serials, the price per work order, the total, and your payment terms. They can **Accept Quote** by signing and entering their printed name, or decline with a reason.

If the account is set to require a PO, the **PO number** field is required before they can accept.

On acceptance, the PO number is written onto every quoted work order that does not already have one. An existing PO, whether a blanket PO from the equipment profile or one you keyed by hand, is more specific and is never overwritten.

## Require a quote on an account

Most PM customers never ask for a quote, so this is opt-in per customer.

On the [customer's page](/help/office/manage-customers), turn on **Require an accepted quote before PM work starts**.

With it on:

- PM rows for that customer show an amber **Quote Needed** badge until an accepted quote covers them.
- Techs **can still be assigned** the work.
- Techs **cannot start or complete** it. Start Work is blocked, and so is completing straight from Assigned. The ticket shows a **Waiting on an accepted quote** banner naming the quote and its current status.

Leaving the setting off does not stop you quoting that customer. The **Quote** button is available for anyone; the setting only controls the badges, the queue nudges, and the start-work block.

## Statuses

| Status | Meaning | Where it can go |
|---|---|---|
| Draft | Built, not yet handed over | Sent, Void |
| Sent | Customer has it, awaiting an answer | Accepted, Declined, Expired, Void |
| Accepted | Authorizes the work. This is the one the start-work block looks for | Void |
| Declined | Customer said no | Sent again, Void |
| Expired | Ran past its validity without an answer | Sent again, Void |
| Void | Superseded or built in error | Nothing, this is final |

**Accepted is close to final on purpose.** It is what authorizes work that may already be underway, so it cannot wander back to draft.

## Changing a quote after it is sent

There is no revision or versioning yet. To change a price or add a work order, **Void** the old quote and build a new one from the board.

Voiding an accepted quote re-blocks the work orders it covered, which is usually what you want if the customer's authorization no longer stands.

## Note

A voided quote's PDF looks the same as a live one, with nothing on the page marking it void. Check the status in **PM Quotes** before sending a PDF you did not just generate.
