---
title: Bill completed work
category: Managers
roles: [super_admin, manager, coordinator]
order: 60
summary: Export completed PMs and service tickets for billing — and what it takes to mark them billed.
last_verified: 2026-09-01
---

The **Billing** page lists completed work that hasn't been invoiced yet. Billing is a two-step flow: **export** the work to a PDF, then **mark it billed** once you've created the invoice in Synergy. Exporting no longer marks anything billed on its own — a ticket only counts as billed after its Synergy invoice number is entered.

The expectation is to key the Synergy order the same day the work completes — export never waits on a PO, so there's no reason to let the order number sit. If a job's Synergy order, PO, or invoice # falls behind, it shows up on the **[Billing Chase](/help/managers/billing-chase)** worklist for the office to work.

## Find a ticket

Each tab has a **Search** box at the top. Type any part of a customer name, account number, **WO#**, equipment make/model, serial number, technician, **PO #**, or **Synergy order #** — plus the **Synergy invoice #** on the Awaiting Invoice # and Invoiced lists — and the rows narrow as you type. Several words all have to match, in any order: `acme 1638` finds work order 1638 for Acme and nothing else.

On the **PM Tickets** and **Service Tickets** tabs one box narrows **both** lists at once, so you don't have to guess whether a job is still in **Ready to Export** or already sitting in **Awaiting Invoice #**. The section heading counts what's showing against the full list — *Ready to Export (3 of 14)*. Clear the box with the **×** to get everything back; switching tabs clears it too.

Two things the search deliberately does **not** do:

- **It never hides a warning.** The amber banners ("*3 tickets need a Synergy invoice #*", "*2 tickets are waiting on a PO*") always count the whole list, so searching can't hide a job that's blocked.
- **It never quietly drops a ticket you ticked.** Selections survive a search, so you can search one customer, tick their rows, then search another and tick more before exporting once. If a ticked row is currently hidden, an amber **_n_ hidden by your search** note appears next to the selected count — those rows are still going to be exported or marked billed. The confirmation step always lists everything that's actually selected.

## Bill PM tickets

The **PM Tickets** tab has two sections: **Ready to Export** at the top, and **Awaiting Invoice #** below it.

### 1. Export

1. Tap **Billing** → **PM Tickets**. The top list shows completed PMs that haven't been exported yet. Each row shows the **account number** and **ship-to** under the customer name, the **serial number** under the equipment, and the **WO#** — handy for telling apart customers or machines that share a name. Tap the **WO#** column header to sort by work order number when you're matching rows against Synergy.
2. Check the **PO** column:
   - **PO Needed** (red) — the customer requires a PO and none is entered. Tap it, type the **PO number**, and **Save** — right here without opening the ticket.
   - A green PO number means it's set; **—** means no PO is required.
3. *(Optional)* Fill in the **Synergy Order #** column. Tap **+ Synergy Order #** and type the Synergy order number you're billing against. Entering it **before** you export prints it on the exported PDF, so you can match each work order back to its Synergy record when you key the invoice number in later. It's optional and never blocks export — and you can still add or change it afterward in **Awaiting Invoice #**.
4. Tick the tickets to export. A missing PO doesn't stop you here — it's checked later, at Mark Billed.
5. Tap **Export PDF** → review the preview (anything missing is flagged in amber) → tap **Export PDF** again to confirm.

The PDF downloads and those tickets move down into **Awaiting Invoice #**. They are **not billed yet** — exporting just hands you the PDF to key into Synergy.

### 2. Mark billed

1. Create the invoices in Synergy from the PDF.
2. Back on the **PM Tickets** tab, find each ticket in **Awaiting Invoice #**. Tap **Invoice # Needed**, type the **Synergy invoice number**, and **Save** — one invoice per work order.
3. Tick the tickets that now have an invoice number and tap **Mark Billed**. They flip to billed and drop off the list.

A nightly check watches Synergy for orders that were invoiced there but not yet keyed here. When it finds one, it pre-fills the **Synergy invoice number** and tags the row with an emerald **Synergy shows invoiced — confirm** pill. Auto-detected rows float to the top of **Awaiting Invoice #** so you see them first — glance at the number, and if it's right, tick the row and **Mark Billed** as usual. Nothing changes about the gate: it's still a pre-filled number waiting on your confirmation, not an auto-bill.

**Awaiting Invoice #** carries the same sortable **WO#** column, so you can line its rows up against the PDF you just exported. Each row also has the optional **Synergy Order #** field next to the invoice number — the same one from **Ready to Export**, so anything you entered before exporting shows here too. Tap **+ Synergy Order #** to jot down (or correct) the Synergy order number you're billing against so it stays on screen while you track down the matching invoice — then key that invoice number in. It's only a reference and never blocks **Mark Billed**.

Exported a ticket by mistake? Tap **Un-export** on its row, then confirm **Just this one** — only that single work order goes back to **Ready to Export** (this clears any invoice number you entered). Un-export only ever affects the one row you tapped.

## Bill service tickets

Service tickets follow the same idea: each must have its **Synergy Invoice #** entered before it can be marked billed — that's the number proving the work was invoiced in Synergy. The service **Ready to Export** list carries the same optional **Synergy Order #** column — fill it in before you export and it prints on the work order you download. The Synergy Order # also stays editable later in **Awaiting Invoice #**, next to the invoice number. Both service lists show the sortable **WO#** column as well.

You can export service tickets two ways:

- **One at a time** — tap **Export** on a row to download just that work order.
- **Several at once** — tick the checkbox on each row you want, then tap **Export Selected**. **Select all** ticks every row currently shown, so you can search one customer, select theirs, search another and add more; the amber **_n_ hidden by your search** note tells you when ticked rows are off screen, and those still export. The running count and dollar total next to the button show what you've picked. This downloads **one PDF containing every work order you selected**, a page each — so a month of service work is one click and one file instead of one of each.

Either way the tickets move to **Awaiting Invoice #** together, and a missing PO never blocks the export. Because a combined PDF is one document, its page footers number the whole stack ("Page 3 of 7") rather than each work order — if you need a clean single copy to send a customer, export that row on its own.

Use the **Service Type** toggle at the top of the tab — **All / Inside / Outside** — to work one group at a time. It narrows both the **Ready to Export** and **Awaiting Invoice #** lists at once, so you can clear all the inside (bench) repairs before switching to the outside (field) ones.

The same nightly Synergy check and emerald **Synergy shows invoiced — confirm** pill described above for PM tickets covers service tickets too, on the same **Awaiting Invoice #** list.

## What's on the PDF

Per ticket: customer and account, equipment, technician, completion date, machine hours and date code, the **Synergy order #** (when you've entered one), the PM (flat-rate) line plus any additional labor/parts, the line total, and the customer's signature and photos when captured. Taxes are not included.

## Gotchas

- **Exporting no longer bills anything.** A PM ticket is billed only after you enter its **Synergy invoice number** and tap **Mark Billed**. This keeps "billed" meaning the work was actually invoiced.
- **One Synergy invoice per work order** on PM tickets.
- **A required PO doesn't block export** — it can be entered before or after. It gates **Mark Billed** instead, for both PM and service tickets, right alongside the Synergy invoice #. Fill it inline from this page.
- **A missing Synergy Invoice # blocks a service ticket** from being marked billed.
- **A warranty ticket is blocked for one of two reasons.** A ticket flagged for warranty and not yet verified shows an amber **Warranty review pending** flag; a verified ticket whose vendor credit hasn't landed shows **Awaiting vendor credit**. Either way it can't be selected. Clear it on the **Warranty Claims** queue, not from here. See [File a warranty claim and log the vendor credit](/help/managers/file-a-warranty-claim).
- **The amount shown is what the customer pays, not the claim total.** Once a warranty ticket is verified, this page shows the net customer amount (covered lines removed), with the full claim value shown alongside it when they differ. Nothing here silently drops revenue: the difference is the vendor credit the office is chasing.
- **Un-export** is the undo for an accidental export — it returns the ticket to Ready to Export and clears the invoice number.
- **Synergy Order #** is an optional reference that helps you find the invoice in Synergy — it never blocks billing. Only the **Synergy Invoice #** does. Enter it in **Ready to Export** before exporting and it prints on the work order; you can still add or change it afterward in **Awaiting Invoice #**.
- **The emerald pill means "confirm," not "billed."** An auto-detected invoice number still needs a human to tick the row and tap **Mark Billed** — Synergy showing invoiced isn't the same as this ticket being marked billed here.
- **Typing over a pre-filled invoice number is fine.** If the auto-filled number is wrong, just correct it and save — the pill clears once you've entered your own number.
- **Search keeps your ticks, even the ones it hides.** Narrowing the list doesn't clear what you've already selected. Watch for the amber **_n_ hidden by your search** note next to the selected count — it means rows you can't see right now are still part of the export or Mark Billed you're about to confirm.
- **Falling behind on any of the three fields** (Synergy order #, PO, invoice #) puts the job on the **[Billing Chase](/help/managers/billing-chase)** worklist, where it stays until it's cleared.
