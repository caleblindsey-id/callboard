---
title: Work the Billing Chase list
category: Managers
roles: [super_admin, manager, coordinator]
order: 61
summary: One worklist for every completed PM and service job missing a Synergy order #, a required PO, or a Synergy invoice # — log contact attempts and clear jobs for billing.
last_verified: 2026-08-27
---

**Billing Chase** is the office's single worklist for completed jobs that aren't ready to bill yet. It replaces chasing PM and service tickets separately, and replaces keeping the missing-PO list in your head or on a sticky note. Reach it from the **Billing Chase** card on the Dashboard whenever it's showing a count, or go straight to `/billing/po-follow-up`.

## Who does this

Managers and coordinators. This page sits alongside the **Billing** page but is a distinct list — see [Bill completed work](/help/managers/billing) for the export and Mark Billed flow itself.

## What lands on the list

A completed PM or service job shows up here for any of three reasons, and a job can carry more than one at once:

- **Not entered** (red) — no Synergy order # on the ticket yet. The expectation is to key it the same day the work completes; nothing should sit here overnight.
- **PO needed** (amber) — the customer requires a PO and none is on file.
- **Not invoiced** (blue) — the ticket has been exported but has no Synergy invoice # yet.

Both PM and service tickets appear together, tagged with a **PM** or **Service** chip. A job with none of the three missing is already clean and never shows up here — this is a worklist of what's actually blocking billing, not a full job list.

## Work the list

1. Open **Billing Chase**. Rows sort with the most-blocked jobs (carrying the most reasons) first, then oldest-completed first, so you're working the worst offenders.
2. Enter whatever's missing right on the row: tap the **Synergy Order #**, **PO**, or **Invoice #** cell to edit it inline — no need to open the ticket. The PO cell only appears editable when that customer actually requires one.
3. If you reach out to the customer or vendor and don't have the field yet, tap **Log / History** to open the contact drawer. Pick a method (**Call**, **Email**, **Text**, **Other**), add an optional note, and tap **Log Contact**. The drawer also shows every past contact for that job, newest first, so you can see what's already been tried.
4. Once a job clears all its reasons, it drops off the list on its own — nothing to check off manually.

The **Last Contact** column colors by how long it's been since the last logged attempt: green under 3 days, amber 3–6 days, red 7 days or more (or **Not contacted** if nothing's been logged yet). Use it to decide who to chase next.

## How this connects to billing

Entering the Synergy order # here is the same field the **Billing** export screens use — fill it in from either place and it shows up on both. The **PO** and **Synergy Invoice #** fields work the same way: this list and the **Billing** queues are two views of the same tickets, so nothing you enter here needs to be re-entered there.

Clearing every reason on a job doesn't do anything else automatically — it still needs to be exported (if it hasn't been) and marked billed from the **Billing** page once its invoice # is in. Billing Chase exists to surface what's missing, not to replace the Mark Billed step.

## Showing up in the digest

Jobs with a missing Synergy order # that have sat completed for more than one business day, and jobs waiting on a customer PO, both surface in the weekday morning digest so a stalled job doesn't go unnoticed just because nobody happened to check this page. The digest links straight back to this list.

## Gotchas

- **This list is about what's missing, not who's assigned.** It shows every completed job across all technicians and customers — there's no per-tech filter here (see the tech's own **My Jobs Waiting on PO** tile on their board for that).
- **A contact log entry doesn't clear a reason by itself.** Logging that you called the customer records the attempt; the job only drops off the list once the actual field (Synergy order #, PO, or invoice #) is entered.
- **"Not invoiced" only appears after export.** A job that hasn't been exported yet won't show the invoice-# reason — export it from **Billing** first, or let the auto-detect check catch it (see [Bill completed work](/help/managers/billing)).
