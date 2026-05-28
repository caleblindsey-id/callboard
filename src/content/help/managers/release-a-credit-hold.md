---
title: Release or block a credit hold
category: Managers
roles: [super_admin, manager, coordinator]
order: 40
summary: How credit-hold work gets reviewed by AR and released — or blocked and overridden.
last_verified: 2026-05-28
---

A customer is on **credit hold** when their AR balance is over their credit limit, or they're past the allowed past-due days. When work is created for them, CallBoard gates it and sends it to AR to decide. Manage these on the **Credit Review** page.

## The two tabs

- **Pending AR Review** — orders waiting on an AR decision. If AR never got the email (or it expired), tap **Resend AR** to send a fresh link.
- **Blocked by AR** — orders AR declined. These stay locked until a manager overrides them.

## How AR decides (the email link)

AR receives an email with a link to a private page for each order. There they:

1. Enter **Your name**.
2. Tap **Release — let this work proceed**, or **Block this work** (with an optional reason, then **Confirm block**).

Releasing unblocks the work immediately. Blocking locks it until a manager overrides.

## Overriding a block (manager passcode)

On a **Blocked by AR** order, tap **🔒 Unblock**, enter the **Release passcode**, and tap **Unblock & proceed**. The passcode is set by an admin in [Settings](/help/admin/settings) — share it only with managers and AR.

## Gotchas

- **The credit-hold flag comes from the AR numbers** (balance vs. credit limit, past-due days). To clear it for good, the customer's account has to be brought current — releasing here just lets *this* work proceed.
- **The AR link is single-use and expires.** If AR sat on it too long, use **Resend AR** for a new one.
- **No passcode set = no overrides.** If managers can't unblock, an admin needs to set the release passcode in Settings.
