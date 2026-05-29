---
title: FAQ and troubleshooting
category: Reference
roles: [super_admin, manager, coordinator, technician]
order: 20
summary: Quick answers to the questions that come up most.
last_verified: 2026-05-28
---

## Why is my ticket blocked from billing?

Usually one of three things:

- The customer is on **credit hold** and AR hasn't released this work yet — check the [Credit Review](/help/managers/release-a-credit-hold) page.
- The customer requires a **PO** and none is entered — fill it in on the [Billing](/help/managers/billing) page.
- It's a service ticket missing its **Synergy Order #** — add it before marking billed.

## Why won't a ticket let me mark it complete?

Almost always an **unreceived part** (a part was ordered but hasn't been marked received), or a missing required field — Machine Hours, Date Code, or the customer signature/printed name on a field ticket. The message at the top of the form says which.

## When does a credit hold release?

When **AR clicks Release** on the emailed link, or a **manager overrides a block** with the release passcode. Releasing lets *this* work proceed; the customer's account itself clears the hold once it's brought current in Synergy.

## Why didn't a lead earn a bonus?

- **PM lead:** only monthly, bi-monthly, and quarterly **flat-rate** schedules earn. Semi-annual, annual, or non-flat billing won't.
- **Equipment-sale lead:** the bonus pays only when a qualifying sale is confirmed within the match window.
- The lead also has to reach **Earned** status — approved isn't the same as earned.

See [Submit a lead](/help/technicians/submit-a-lead) and [Approve tech leads](/help/managers/approve-tech-leads).

## Why can't a technician see a customer / ticket / page?

By design. Technicians see only **their own** assigned tickets, leads, and equipment, and don't have access to billing, analytics, credit review, or admin pages. If a tech needs broader access, a super admin can change their role. See [Roles and permissions](/help/overview/roles-and-permissions).

## A customer's address or contact is wrong — how do I fix it?

Those come from **Synergy and are read-only** in CallBoard. Fix it in Synergy; it updates here on the next nightly sync (usually the next day). The same goes for adding a new contact or ship-to. See [The nightly Synergy sync](/help/admin/sync-status).

## Something's broken or confusing — how do I report it?

Use the **Send Feedback** button in the bottom-right corner of any screen. It goes straight to the team.
