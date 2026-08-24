---
title: Ship-to locations
category: Office
roles: [super_admin, manager, coordinator, technician]
order: 60
summary: How ship-to addresses work, and how to request a new one that isn't in Synergy yet.
last_verified: 2026-08-24
---

A customer can have many ship-to locations. They're **synced from Synergy and read-only** in CallBoard — you'll see them on the customer record and as a dropdown when creating equipment or a service ticket.

## Requesting a new ship-to

If the location you need isn't in the list yet, request it (techs and office can both do this):

1. On a PM ticket, tap **Change location**.
2. In the location list, tap **Don't see it? Request a new location**.
3. Describe the address — for example, "1234 Industrial Blvd, Suite 200, Birmingham AL 35203 — back loading dock."
4. Tap **Send Request**. You'll see "Office has been notified."

## How the office completes it

Requests land on the **Ship-To Requests** queue (Queues in the sidebar, and a card on the dashboard when any are waiting). Repeat requests for the same address are grouped, so closing one closes them all.

For each request the queue offers two paths:

- **Link this location.** If the address already exists under that customer, the queue suggests it. This happens more often than you would think, because Synergy names a location after the business, not the street, so a tech searching by address will not find it.
- **Add it now.** Add the location in **Synergy** first (it still can't be created there from CallBoard), then enter its Synergy ship-to code here. The location becomes selectable straight away rather than the next day, and the overnight sync fills in the rest and confirms it.

You can also **Dismiss** a request that was a mistake or a duplicate.

## Good to know

- **Adding it in Synergy is still the first step.** CallBoard records the code, it does not create the account record.
- If nobody records the location in CallBoard, the requested address is only available the **next day**, after the nightly sync.
- Existing ship-to details can't be edited in CallBoard either — those corrections happen in Synergy.
