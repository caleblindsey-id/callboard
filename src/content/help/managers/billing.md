---
title: Bill completed work
category: Managers
roles: [super_admin, manager, coordinator]
order: 60
summary: Export completed PMs and service tickets for billing — and what it takes to mark them billed.
last_verified: 2026-06-23
---

The **Billing** page lists completed work that hasn't been invoiced yet. Billing is a two-step flow: **export** the work to a PDF, then **mark it billed** once you've created the invoice in Synergy. Exporting no longer marks anything billed on its own — a ticket only counts as billed after its Synergy invoice number is entered.

## Bill PM tickets

The **PM Tickets** tab has two sections: **Ready to Export** at the top, and **Awaiting Invoice #** below it.

### 1. Export

1. Tap **Billing** → **PM Tickets**. The top list shows completed PMs that haven't been exported yet. Each row shows the **account number** and **ship-to** under the customer name, and the **serial number** under the equipment — handy for telling apart customers or machines that share a name.
2. Check the **PO** column:
   - **PO Needed** (red) — the customer requires a PO and none is entered. Tap it, type the **PO number**, and **Save** — right here without opening the ticket.
   - A green PO number means it's set; **—** means no PO is required.
3. *(Optional)* Fill in the **Synergy #** column. Tap **+ Synergy Order #** and type the Synergy order number you're billing against. Entering it **before** you export prints it on the exported PDF, so you can match each work order back to its Synergy record when you key the invoice number in later. It's optional and never blocks export — and you can still add or change it afterward in **Awaiting Invoice #**.
4. Tick the tickets to export (rows missing a required PO can't be selected).
5. Tap **Export PDF** → review the preview (anything missing is flagged in amber) → tap **Export PDF** again to confirm.

The PDF downloads and those tickets move down into **Awaiting Invoice #**. They are **not billed yet** — exporting just hands you the PDF to key into Synergy.

### 2. Mark billed

1. Create the invoices in Synergy from the PDF.
2. Back on the **PM Tickets** tab, find each ticket in **Awaiting Invoice #**. Tap **Invoice # Needed**, type the **Synergy invoice number**, and **Save** — one invoice per work order.
3. Tick the tickets that now have an invoice number and tap **Mark Billed**. They flip to billed and drop off the list.

Each row also has the optional **Synergy #** field next to the invoice number — the same one from **Ready to Export**, so anything you entered before exporting shows here too. Tap **+ Synergy Order #** to jot down (or correct) the Synergy order number you're billing against so it stays on screen while you track down the matching invoice — then key that invoice number in. It's only a reference and never blocks **Mark Billed**.

Exported a ticket by mistake? Tap **Un-export** on its row, then confirm **Just this one** — only that single work order goes back to **Ready to Export** (this clears any invoice number you entered). Un-export only ever affects the one row you tapped.

## Bill service tickets

Service tickets follow the same idea: each must have its **Synergy Invoice #** entered before it can be marked billed — that's the number proving the work was invoiced in Synergy. The service **Ready to Export** list carries the same optional **Synergy #** column — fill it in before you tap **Export** and it prints on the work order you download. Each service ticket exports its own work-order PDF (one per row). The Synergy # also stays editable later in **Awaiting Invoice #**, next to the invoice number.

Use the **Service Type** toggle at the top of the tab — **All / Inside / Outside** — to work one group at a time. It narrows both the **Ready to Export** and **Awaiting Invoice #** lists at once, so you can clear all the inside (bench) repairs before switching to the outside (field) ones.

## What's on the PDF

Per ticket: customer and account, equipment, technician, completion date, machine hours and date code, the **Synergy order #** (when you've entered one), the PM (flat-rate) line plus any additional labor/parts, the line total, and the customer's signature and photos when captured. Taxes are not included.

## Gotchas

- **Exporting no longer bills anything.** A PM ticket is billed only after you enter its **Synergy invoice number** and tap **Mark Billed**. This keeps "billed" meaning the work was actually invoiced.
- **One Synergy invoice per work order** on PM tickets.
- **A required PO blocks export** until it's entered (it's checked again at export). Fill it inline from this page.
- **A missing Synergy Invoice # blocks a service ticket** from being marked billed.
- **Un-export** is the undo for an accidental export — it returns the ticket to Ready to Export and clears the invoice number.
- **Synergy #** is an optional reference that helps you find the invoice in Synergy — it never blocks billing. Only the **Synergy Invoice #** does. Enter it in **Ready to Export** before exporting and it prints on the work order; you can still add or change it afterward in **Awaiting Invoice #**.
