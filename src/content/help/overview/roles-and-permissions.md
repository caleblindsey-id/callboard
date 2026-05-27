---
title: Roles and permissions
category: Overview
roles: [super_admin, manager, coordinator, technician]
order: 50
summary: The four roles in CallBoard and what each one can see and do.
last_verified: 2026-05-27
---

Every CallBoard user has one of four roles. Your role decides which sections you see in the menu and what actions you're allowed to take. This keeps the field view simple for technicians and reserves sensitive actions — deleting tickets, changing settings, managing users — for the people who should have them.

## The four roles

| Role | Who it's for | What they can do |
|---|---|---|
| **Technician** | Field techs | See and complete **their own** assigned PMs and service tickets, submit leads, look up products, and view their assigned equipment (read-only). Cannot see other techs' work, billing, or analytics. |
| **Coordinator** | Office staff | Everything in the day-to-day workflow: tickets, equipment, customers, parts queue, estimates, billing, and leads. Cannot delete tickets, reset a ticket's status, or change app settings. |
| **Manager** | Branch / service managers | Everything a coordinator can do, **plus** deleting tickets, resetting/reopening ticket status, approving skips and leads, and releasing credit holds. |
| **Super Admin** | System owner | Everything a manager can do, **plus** creating users, changing roles, editing app settings, and viewing the audit log. |

## A few things to know

- **Technicians see only their own work.** A tech can't open another technician's ticket or browse the full customer list — this is by design, not a bug.
- **Customers and products are read-only for everyone.** They come from Synergy. To correct one, fix it in Synergy; the change flows over on the next nightly sync.
- **Some actions are deliberately limited.** If a button you expect isn't there, your role probably doesn't permit that action. A manager or admin can do it, or change your role if appropriate.

## Need a different role or a new user?

Only a Super Admin can create accounts or change roles. Ask your manager or admin.
