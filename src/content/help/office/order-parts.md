---
title: Order parts (the Parts Queue)
category: Office
roles: [super_admin, manager, coordinator]
order: 20
summary: Work the shared queue of parts requested across all tickets — decide stock vs. order, pull or order them, and receive them in.
last_verified: 2026-06-19
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

## Ordering a part

For each row in **To Order**:

1. Set the **Vendor** — pick from the Synergy vendor list. (Old free-text vendors show a "legacy" badge; re-pick from Synergy to clear it.)
2. Enter the **Synergy Item #** — search the catalog and pick the match, or enter it manually if there's no catalog match.
3. Enter the **Synergy Order #** for the ticket and the **Synergy PO #** for the part.
4. Tap **Mark Ordered**.

> **Mark Ordered stays greyed out until both the Synergy Item # and Synergy PO # are filled in** (hover the button to see which is missing). The row's Synergy Order # is shared by every part on the same ticket — set it once and it applies to all of them.

Fields save **when you click away** (on blur), not when you press Enter.

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
