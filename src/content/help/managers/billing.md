---
title: Bill completed work
category: Managers
roles: [super_admin, manager, coordinator]
order: 60
summary: Turn completed PMs and service tickets into billing PDFs — and what gates a ticket from billing.
last_verified: 2026-05-28
---

The **Billing** page lists completed work that hasn't been invoiced yet. You export it to a PDF, which also marks the tickets as billed — then you create the invoices in Synergy.

## Bill PM tickets

1. Tap **Billing**. The **PM Tickets** tab shows completed, not-yet-billed PMs.
2. Check the **PO** column:
   - **PO Needed** (red) — the customer requires a PO and none is entered. Tap it, type the **PO number**, and **Save**. You can do this right here without opening the ticket.
   - A green PO number means it's set; **—** means no PO is required.
3. Tick the tickets to bill (rows with a missing required PO can't be selected).
4. Tap **Export PDF**. A preview opens — anything missing data is flagged in amber.
5. Tap **Export PDF** again to confirm.

The PDF downloads, and those tickets are **marked billed** in the same step ("PDF exported — N tickets marked as billed"). They drop off the list.

## Bill service tickets

Service tickets bill the same way, but each must have its **Synergy Order #** entered before it can be marked billed — that's the number tying the work back to the order in Synergy.

## What's on the PDF

Per ticket: customer and account, equipment, technician, completion date, machine hours and date code, the PM (flat-rate) line plus any additional labor/parts, the line total, and the customer's signature and photos when captured. Taxes are not included.

## Gotchas

- **Exporting the PDF is how a ticket gets marked billed** — there's no separate "mark billed" button on PM tickets.
- **A required PO blocks billing** until it's entered (it's checked again at export). Fill it inline from this page.
- **A missing Synergy Order # blocks a service ticket** from being marked billed.
