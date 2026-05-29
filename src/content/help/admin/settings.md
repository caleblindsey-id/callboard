---
title: App settings
category: Admin
roles: [super_admin]
order: 20
summary: Labor rates, PDF branding, credit-review setup, and sales reps. Super admins only.
last_verified: 2026-05-28
---

The **Settings** page is where a super admin configures the things the rest of the app depends on.

## Labor rates

Set the per-hour rate for **Standard**, **Industrial**, and **Vacuum** work. These drive billing amounts on ticket completion — the rate type is picked per ticket when it's created.

## Customer PDF branding

**Company Name**, **Service Email**, and **Service Phone** appear in the header of the customer PM work-order PDF. Leave email or phone blank to omit that row.

## Credit review

- **AR notification email(s)** — comma-separated. **Required:** without it, credit-hold work is still gated but no one gets notified. These are the people who receive the release/block emails.
- **Release passcode** — the code managers use to override a blocked order. At least 8 characters, stored hashed and never shown again. The badge tells you whether one is set; if not, managers can't unblock anything. Rotate it here to revoke the old one.

## Sales reps

Add the sales reps a manager can forward an approved **equipment-sale lead** to — Name, Email, and Role (Sales Rep / Sales Manager / Branch Manager). These reps are recipients, not CallBoard logins.

## Gotcha

Most of this is **super-admin-only to change**. Managers can see some values but can't edit them — route setup requests through an admin.
