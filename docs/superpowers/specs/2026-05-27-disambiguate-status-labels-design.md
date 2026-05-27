# Disambiguate cross-system status labels (labels-only)

- **Date:** 2026-05-27
- **Source:** Feedback #13 (Caleb Lindsey, super_admin) — "We need a better way to differentiate the different ticket types and their status. For example 'ready for pickup' could refer to parts ready to be picked up by techs or that a customer's machine is ready for pickup after service has been completed."
- **Scope decided with Caleb:** labels-only (no visual redesign), focused on telling the **systems** (PM / Service / Parts) apart.

## Problem

The word **"pickup"** is used for two unrelated subjects:

- **Parts** a *technician* collects — derived from `parts.status = 'received'`.
- A **machine** a *customer* collects after service — the `service_tickets.awaiting_pickup` flag.

The bare labels ("Ready for Pickup", "Awaiting Pickup") don't say which subject they mean, so they read as the same thing.

## Principle

A status label should **name the subject it acts on** whenever the bare word could be read against another system. Here that means prefixing the colliding "pickup" labels with their subject: **Parts** vs **Customer**.

## Changes (the entire change — 5 user-visible strings, 3 files)

| # | File / line | Subject | Before | After |
|---|---|---|---|---|
| 1 | `src/components/dashboard/PartsPipeline.tsx:83` | parts (tech) | `Ready for Pickup` | `Parts Ready for Pickup` |
| 2 | `src/app/service/[id]/ServiceTicketDetail.tsx:2297` | machine (customer) | `Mark Awaiting Pickup` | `Mark Awaiting Customer Pickup` |
| 3 | `src/app/service/[id]/ServiceTicketDetail.tsx:2297` | machine (customer) | `Awaiting Pickup` | `Awaiting Customer Pickup` |
| 4 | `src/app/service/[id]/ServiceTicketDetail.tsx:2297` | machine (customer) | `Picked Up` | `Customer Picked Up` |
| 5 | `src/components/dashboard/TechDashboard.tsx:104` | parts (tech) | `My Parts Ready` | `My Parts Ready for Pickup` |

Changes #2–#4 are the three states of one ternary on `ServiceTicketDetail.tsx:2297`.

## Notes

- The "Customer Pickup" toggle (changes #2–#4) renders only on **inside**-type service tickets — see the `{/* Inside ticket pickup toggle */}` comment at `ServiceTicketDetail.tsx:2284`. Expected; outside tickets never show it.
- A non-user-facing code comment at `src/lib/db/service-tickets.ts:296` ("Parts Ready for Pickup") may optionally be left as-is — it does not render.

## Out of scope

- **No DB / enum / migration changes** — these are derived display strings, not stored statuses.
- **No visual redesign** — colors, badges, icons unchanged.
- **Other work-item types** (Tech Leads, ACE Labor, Credit Reviews) — their "awaiting/pending" labels don't collide with pickup; the same principle could be a later follow-up.
- Already self-explanatory and untouched: `TicketActions.tsx:1470` "Ready" (work-order doc), parts-queue tabs (`To Order` / `Ordered` / `Received`), `Ready to Bill`.

## Verification

- `npm run typecheck` (or project equivalent) and `npm run build` pass — pure string edits, no type/logic change expected.
- Eyeball: dashboard **Parts Pipeline** card now reads "Parts Ready for Pickup"; an **inside** service ticket detail toggle cycles "Mark Awaiting Customer Pickup" → "Awaiting Customer Pickup" → "Customer Picked Up"; tech dashboard shows "My Parts Ready for Pickup".
