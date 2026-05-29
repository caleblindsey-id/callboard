---
title: Provision a user and set roles
category: Admin
roles: [super_admin]
order: 10
summary: Create accounts, assign roles, and set a technician's hourly cost. Super admins only.
last_verified: 2026-05-28
---

Creating users and changing roles is limited to **super admins**, from the **Settings** page.

## Create a user

1. Open **Settings** and find the **Users** section.
2. Tap **Add User**.
3. Enter **Name**, **Email**, and pick a **Role** — Technician, Coordinator, Manager, or Super Admin (see [Roles and permissions](/help/overview/roles-and-permissions)).
4. Tap **Add User**.

CallBoard generates a **temporary password and shows it once**. Share it with the new user securely — they'll be required to set their own password the first time they log in.

## Change someone's role

In the Users table, change the role from the dropdown on that person's row. It saves immediately.

> You **can't change your own role** — that safeguard stops an admin from accidentally locking themselves out. Have another super admin do it if needed.

## Set a technician's hourly cost

In the Users table, set a technician's **hourly rate** (their cost per hour). This feeds the **Gross Profit** numbers in [Analytics](/help/managers/analytics) — without it, profit shows blank.

## Gotcha

The temp password is shown **only once** at creation. If it's lost before first login, you can't look it up — create a fresh one or have the user use **Forgot password**.
