---
title: Order parts (the Parts Queue)
category: Office
roles: [super_admin, manager, coordinator]
order: 20
summary: Work the shared queue of parts requested across all tickets — order them and receive them in.
last_verified: 2026-05-28
---

The **Parts Queue** is one shared list of every part technicians have requested across all PM and service tickets. You fill in the ordering details and move each part from requested → ordered → received.

Tap **Parts Queue** in the menu. There are three tabs:

- **To Order** — parts a tech requested that haven't been ordered yet.
- **Ordered** — parts you've placed with a vendor.
- **Received (14d)** — parts that have arrived, from the last 14 days.

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

## Finding parts

- **Search** by customer, WO #, part, or PO #.
- Filter by **source** (All / PM only / Service only) and by **vendor**.

## Related

- To drop a part you no longer need, see [Cancel a part](/help/office/cancel-a-part).
- A part can't be received — and the ticket can't be completed — until it's been ordered, so keep this queue current.
