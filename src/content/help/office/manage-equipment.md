---
title: Manage equipment and PM schedules
category: Office
roles: [super_admin, manager, coordinator]
order: 40
summary: Add and edit machines, set default parts, and configure the PM schedule that drives ticket generation.
last_verified: 2026-05-28
---

Equipment and its PM schedule are owned by CallBoard (unlike customers and products, which come from Synergy). This is where you set up what gets maintained, how often, and at what rate.

## Adding a machine

1. Tap **Equipment**, then **Add Equipment**.
2. Pick the **Customer** (required), then a **Ship-To Location** if they have one.
3. Fill in Make, Model, Serial, Description, and Location on Site. A serial that already exists for that customer is flagged.
4. Add an on-site **Contact** and a **Default Technician** if you know them.
5. Optionally tick **Add PM Schedule** and set it up right here (see below).
6. Optionally add **Default Products**.
7. Tap **Add Equipment**.

You can edit any of these later from the machine's detail page (**Save Changes**).

## Setting the PM schedule

On the equipment detail page, in the **PM Schedule** section (managers/coordinators only):

- **Frequency** — Monthly, Bi-Monthly, Quarterly, Every 4 months, Semi-Annual, or Annual.
- **Starting Month / Year** — when this PM cycle begins.
- **Billing Type** — Flat Rate, Time & Materials, or Contract. Pick **Flat Rate** and enter the **Flat Rate ($)** for standard PM billing.
- **Skip backfill** — tick this if PMs were already done outside CallBoard, so it doesn't auto-generate tickets for past months. (Backfill is skipped automatically if the start date is more than 3 months ago.)

Save, and CallBoard reports how many past tickets it backfilled (if any).

## Default Products

Add the parts that come standard on this machine's PM. They auto-populate onto **every PM ticket** for it — pre-filled in the blue "PM Service" section techs see, at no extra charge. Search the catalog, set quantities, and **Save Products**.

## Notes, history, and prospects

- **Equipment Notes** — append-only: common part numbers, quirks, access instructions. Techs can add these too.
- **Service History** — a combined timeline of every PM and service ticket for the machine.
- **Prospects** — equipment marked inactive can be tracked as a sales opportunity on the **Prospects** page.

## Gotchas

- **Default Products auto-bill at the flat rate, not separately** — they're the parts *included* in the PM. Truly extra parts go in the ticket's "Additional Work" section.
- **Ship-to locations come from Synergy.** If the one you need isn't in the dropdown, it has to be added in Synergy first (see [Ship-to locations](/help/office/ship-to-locations)).
