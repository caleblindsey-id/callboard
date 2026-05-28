---
title: The nightly Synergy sync
category: Admin
roles: [super_admin, manager, coordinator]
order: 40
summary: What syncs from Synergy each night, and how to check that it ran.
last_verified: 2026-05-28
---

Every night, CallBoard refreshes its copy of the data that lives in Synergy. This is why customers and products are read-only in CallBoard — Synergy is the source, and the sync keeps CallBoard current.

## What syncs

Around **5 AM**, CallBoard pulls the latest **customers, contacts, products, ship-to locations, and technicians** from Synergy.

## Checking that it ran

- **Settings → Sync Log** shows the recent runs with their status (success / running / failed), record counts, and any error.
- The **dashboard** shows a sync banner with the last run and status.

## Gotchas

- **There's no "sync now" button in the app.** It runs on a schedule from the workstation that can reach Synergy. If you need an off-cycle sync, it has to be triggered there (IT).
- **Changes you make in Synergy aren't instant in CallBoard** — they show up after the next nightly run. That's why a corrected customer address or a new ship-to can take until the next day.
- A separate **parts-queue validation** runs about **5:30 AM**. If you fixed a Synergy order number the same day, use the **Re-check** button on the Parts Queue rather than waiting overnight.
