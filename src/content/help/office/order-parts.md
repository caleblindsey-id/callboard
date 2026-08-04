---
title: Order parts (the Parts Queue)
category: Office
roles: [super_admin, manager, coordinator]
order: 20
summary: Work the shared queue of parts requested across all tickets — decide stock vs. order, pull or order them, bill the freight, and receive them in.
last_verified: 2026-08-04
---

The **Parts Queue** is one shared list of every part technicians have requested across all PM and service tickets. You decide whether each part comes from stock or gets ordered, then move it through to fulfilment.

Tap **Parts Queue** in the menu. There are five tabs:

- **Review** — newly requested parts waiting on a stock-vs-order decision.
- **To Pull** — parts you decided to pull from stock, waiting to be picked off the shelf.
- **To Order** — parts you decided to order that haven't been placed with a vendor yet.
- **Ordered** — parts you've placed with a vendor.
- **Received (14d)** — parts that have arrived, from the last 14 days.

## Reviewing a part (stock vs. order)

Every part a tech requests lands in **Review** first. For each row you can see **On Hand** (units in the service warehouse, Whse 4) and **On PO** (units already inbound on an open purchase order) to help you decide:

- Tap **Pull from Stock** if you'll fulfil it from inventory — no PO needed. The part moves to **To Pull**.
- Tap **Order** to send it to the ordering queue. The part moves to **To Order**. If you already have the part on hand or on a PO, you'll be asked to enter a short justification for ordering anyway.

## Pulling a part from stock

Parts you sent to **To Pull** are waiting to be picked off the shelf. Each row shows its Whse 4 **Bin** location.

1. **Export** the pick list (CSV or printable PDF), sorted by Synergy Item # so you can walk the shelf in order.
2. Pull each part, then tap **Mark Pulled**.

Once every part on an order is staged, the technician is notified it's ready for pickup.

If a part was taken off the shelf but nobody tapped **Mark Pulled** before the technician completed the job, you can still clear it: the row stays in **To Pull** and the button keeps working after the ticket is completed or billed. You do **not** need to reopen the ticket — reopening erases the customer's signature and completion photos. Marking a late pull only records who pulled it and when; it won't touch the work order's parts or re-notify the technician.

## Ordering a part

For each row in **To Order**:

1. Set the **Vendor** — pick from the Synergy vendor list. (Old free-text vendors show a "legacy" badge; re-pick from Synergy to clear it.)
2. Enter the **Synergy Item #** — search the catalog and pick the match, or enter it manually if there's no catalog match.
3. Enter the **Synergy Order #** for the ticket and the **Synergy PO #** for the part.
4. Tap **Mark Ordered**.

> **Mark Ordered stays greyed out until both the Synergy Item # and Synergy PO # are filled in** (hover the button to see which is missing). The row's Synergy Order # is shared by every part on the same ticket — set it once and it applies to all of them.

Fields save **when you click away** (on blur), not when you press Enter.

### Rush shipping requests

If the technician asked for faster shipping, the row shows an amber **2-Day** or **Next Day** badge. Hover it to read their note (things like the customer's own carrier account, or a date the part has to land by). Expand the row to see the full request under **Shipping**.

Check for the badge **before** you place the order — it's the only chance to pick the right service level.

## Billing the freight back to the customer

We pay to have special-order parts shipped in, and that cost goes on the customer's invoice.

Right after you tap **Mark Ordered**, you'll be asked **"Freight on this order?"**. Enter what the vendor is charging for shipping and tap **Save shipping**. If the order genuinely has no freight — a stock pull, a warranty replacement, a vendor who ships free over a threshold — tap **No freight on this order** and move on.

A few things worth knowing:

- **You're only asked once per ticket.** The charge covers the whole order, so if several parts ship together, put the total freight in the first time. You won't be prompted again for the other parts.
- **You can change it later.** Expand any row on the ticket and edit **Shipping charge**. That's the place to correct the figure when the vendor's invoice arrives with a different number than the quote.
- **Leaving it blank is not the same as entering 0.** Blank means nobody has answered yet; `0` means you checked and the freight was free.
- **It has to be set before the ticket is completed.** Once a ticket is completed or billed, its total is final and the field locks — you'd have to reopen the ticket to change it.

The amount appears as its own **Shipping** line on the work order and the estimate, separate from the trip charge, and is already included in the ticket's total.

## Receiving a part

When the part arrives, find it in the **Ordered** tab and tap **Mark Received** (the Synergy Item # must be filled in). It moves to **Received** — and shows up on the technician's "ready for pickup" list.

## Changed your mind? Return a part to Review

If you triaged a part the wrong way — say you sent it to **To Order** but it should be pulled from stock instead — tap the **↩ Return to Review** button on the row. It sends the part back to the **Review** tab so you can re-decide. This works from **To Order**, **To Pull**, and **Ordered**; the vendor, PO #, and item # you've entered are kept. A part that's already been **received** can't be returned (the goods are physically in hand) — cancel it instead if needed.

## Finding parts

- **Search** by customer, WO #, part, or PO #.
- Filter by **source** (All / PM only / Service only) and by **vendor**.

## Related

- To drop a part you no longer need, see [Cancel a part](/help/office/cancel-a-part).
- A part can't be received — and the ticket can't be completed — until it's been ordered or pulled, so keep this queue current.
