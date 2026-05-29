---
title: View the audit log
category: Admin
roles: [super_admin]
order: 30
summary: A read-only record of every change to tickets, equipment, customers, and users. Super admins only.
last_verified: 2026-05-28
---

The **Audit Log** records every change made across service tickets, PM tickets, equipment, schedules, customers, and users — newest first. It's super-admin-only and read-only; you can't edit history, only review it.

## Finding a change

Open **Audit Log** and narrow with the filters:

- **WO #** — a specific work order.
- **Entity** — the kind of record (service ticket, PM ticket, equipment, customer, user, and so on).
- **User** — who made the change.
- **Action** — Created, Updated, or Deleted.
- **Actor type** — User, Customer, System, or Sync.
- **From / To** — a date range.

Tap **Apply filters** to run it, or **Reset** to clear. Each row shows when it happened, who did it, the record, the action, and a summary of what changed (for example, "status: unassigned → assigned"). Results page 50 at a time.

## When to use it

- Tracing who changed a price, status, or assignment, and when.
- Confirming whether a change came from a person, the customer (via an approval link), or the nightly sync.
