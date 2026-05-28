---
title: Ship-to locations
category: Office
roles: [super_admin, manager, coordinator, technician]
order: 60
summary: How ship-to addresses work, and how to request a new one that isn't in Synergy yet.
last_verified: 2026-05-28
---

A customer can have many ship-to locations. They're **synced from Synergy and read-only** in CallBoard — you'll see them on the customer record and as a dropdown when creating equipment or a service ticket.

## Requesting a new ship-to

If the location you need isn't in the list yet, request it (techs and office can both do this):

1. On a PM ticket, tap **Change location**.
2. In the location list, tap **Don't see it? Request a new location**.
3. Describe the address — for example, "1234 Industrial Blvd, Suite 200, Birmingham AL 35203 — back loading dock."
4. Tap **Send Request**. You'll see "Office has been notified."

## How the office completes it

The new location has to be added in **Synergy** (it can't be created directly in CallBoard). After the office adds it there, the **nightly sync** brings it into CallBoard, where it then appears in the ship-to dropdowns. The office can mark the request resolved (or dismiss it if it's a duplicate).

## Good to know

- **This is not instant.** Because it routes through Synergy and the nightly sync, a requested location is usually available the **next day**.
- Existing ship-to details can't be edited in CallBoard either — those corrections happen in Synergy.
