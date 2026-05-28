---
title: Reopen, reset, reassign, and skip PM tickets
category: Managers
roles: [super_admin, manager, coordinator]
order: 20
summary: Correct a PM ticket after the fact — reopen, reset its status, approve a skip, reassign, or act in bulk.
last_verified: 2026-05-28
---

Managers can move PM tickets back and forth when something needs fixing. Resets and deletes are limited to managers and super admins.

## Reopen a completed or skipped ticket

On the ticket's detail page:

- **Completed → In Progress:** tap **Reopen Ticket**. The completion data is kept, so the tech can edit and re-submit.
- **Skipped → Unassigned:** tap **Reopen Ticket**. The ticket starts fresh.

## Reset a ticket's status

- **From In Progress:** under the form, **Reset to Assigned** or **Reset to Unassigned** — both clear the draft work; "Unassigned" also clears the technician.
- **From Billed:** in **Manager: Reset ticket status**, choose **Back to Completed** (keeps completion data), **Back to In Progress**, **Back to Assigned**, or **Back to Unassigned** (these clear completion data).

## Approve or deny a skip request

When a tech requests a skip, the ticket shows **Skip Requested** with their reason:

- **Approve Skip** — opens a dialog where you set the **Next Service Date** (month/year), then confirm. The schedule moves to that date.
- **Deny Skip** — the ticket reverts to where it was, for the tech to complete.

## Reassign a technician

Reassignment happens from the **PM board** in bulk (there's no single-ticket reassign button):

1. Tick the checkbox on one or more tickets.
2. In the action bar, choose a tech under **Assign to…** and tap **Assign**.

## Bulk actions on the board

Select tickets with their checkboxes, then:

- **Assign** — assign all selected to one technician.
- **Skip Selected** — steps you through each ticket to set its next service date.
- **Delete Selected** — soft-deletes them. They leave the boards, billing, and PDFs and won't be regenerated, but you can restore them from the **Deleted** view. (Managers/super admins only.)

## Gotcha

Resetting away from **Completed** or **In Progress** clears the technician's work (hours, parts, signature, photos). Use **Back to Completed** from a billed ticket if you only need to un-bill it without losing the completion.
