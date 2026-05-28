---
title: Manage customers and contacts
category: Office
roles: [super_admin, manager, coordinator]
order: 50
summary: What you can view and change on a customer record — most of it comes from Synergy.
last_verified: 2026-05-28
---

Customer records, contacts, and ship-to locations are **synced nightly from Synergy and are read-only** in CallBoard. A few CallBoard-specific settings and notes *are* editable.

## Finding a customer

1. Tap **Customers**.
2. Search by **name or account number**.
3. Tap **View** to open the record.

The list shows account #, name, AR terms, and a **Credit Hold** badge when the customer is flagged.

## What's read-only (from Synergy)

- Name, account number, AR terms, billing address
- Contacts (name, email, phone, primary flag)
- Ship-to locations

To correct any of these, fix it in Synergy — the change flows over on the next nightly sync.

## What you can change in CallBoard

- **Active / Inactive** — toggle at the top of the record.
- **Show pricing on PM work order PDF** — a per-customer toggle for whether prices appear on their PM work orders.
- **Auto-approve threshold** — a dollar amount; estimates at or below it are auto-approved for this customer (overrides the default $100).
- **Billing Notes** — append-only log for collection/AR activity (e.g., "left voicemail re: PO#, customer says paying Friday"). Each note is timestamped with your name.

## Gotcha

If a contact's email or phone is wrong, you can't fix it here — it's a Synergy field. Update it in Synergy and wait for the sync. The same goes for adding a brand-new contact.
