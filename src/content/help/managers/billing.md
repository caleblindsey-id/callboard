---
title: Bill completed work
category: Managers
roles: [super_admin, manager, coordinator]
order: 60
summary: Export completed PMs and service tickets for billing — and what it takes to mark them billed.
last_verified: 2026-06-08
---

The **Billing** page lists completed work that hasn't been invoiced yet. Billing is a two-step flow: **export** the work to a PDF, then **mark it billed** once you've created the invoice in Synergy. Exporting no longer marks anything billed on its own — a ticket only counts as billed after its Synergy invoice number is entered.

## Bill PM tickets

The **PM Tickets** tab has two sections: **Ready to Export** at the top, and **Awaiting Invoice #** below it.

### 1. Export

1. Tap **Billing** → **PM Tickets**. The top list shows completed PMs that haven't been exported yet. Each row shows the **account number** and **ship-to** under the customer name, and the **serial number** under the equipment — handy for telling apart customers or machines that share a name.
2. Check the **PO** column:
   - **PO Needed** (red) — the customer requires a PO and none is entered. Tap it, type the **PO number**, and **Save** — right here without opening the ticket.
   - A green PO number means it's set; **—** means no PO is required.
3. Tick the tickets to export (rows missing a required PO can't be selected).
4. Tap **Export PDF** → review the preview (anything missing is flagged in amber) → tap **Export PDF** again to confirm.

The PDF downloads and those tickets move down into **Awaiting Invoice #**. They are **not billed yet** — exporting just hands you the PDF to key into Synergy.

### 2. Mark billed

1. Create the invoices in Synergy from the PDF.
2. Back on the **PM Tickets** tab, find each ticket in **Awaiting Invoice #**. Tap **Invoice # Needed**, type the **Synergy invoice number**, and **Save** — one invoice per work order.
3. Tick the tickets that now have an invoice number and tap **Mark Billed**. They flip to billed and drop off the list.

Exported a ticket by mistake? Tap **Un-export** on its row to send it back to **Ready to Export** (this clears any invoice number you entered).

## Bill service tickets

Service tickets follow the same idea: each must have its **Synergy Invoice #** entered before it can be marked billed — that's the number proving the work was invoiced in Synergy. (Service tickets don't produce a PDF; you re-key them into Synergy directly.)

## What's on the PDF

Per ticket: customer and account, equipment, technician, completion date, machine hours and date code, the PM (flat-rate) line plus any additional labor/parts, the line total, and the customer's signature and photos when captured. Taxes are not included.

## Gotchas

- **Exporting no longer bills anything.** A PM ticket is billed only after you enter its **Synergy invoice number** and tap **Mark Billed**. This keeps "billed" meaning the work was actually invoiced.
- **One Synergy invoice per work order** on PM tickets.
- **A required PO blocks export** until it's entered (it's checked again at export). Fill it inline from this page.
- **A missing Synergy Invoice # blocks a service ticket** from being marked billed.
- **Un-export** is the undo for an accidental export — it returns the ticket to Ready to Export and clears the invoice number.
