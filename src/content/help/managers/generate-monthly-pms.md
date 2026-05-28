---
title: Generate the monthly PM batch
category: Managers
roles: [super_admin, manager, coordinator]
order: 10
summary: Create the month's PM tickets in one batch, with a preview of what will be created.
last_verified: 2026-05-28
---

Each month you generate the PM tickets that are due, in one pass, from the PM board. CallBoard shows you a preview before anything is created.

## How to generate

1. Tap **Preventive Maintenance** to open the PM board.
2. Set the month, then tap **Generate [Month] PMs**.
3. Review the preview:
   - **Will create** — the count of new tickets that will be added.
   - **Credit review** — customers on credit hold. Their PMs **will still be created** and sent to AR for credit approval automatically; the work stays gated until AR releases each one. They are *not* dropped.
   - **Duplicates** — equipment that already has an open PM from a prior month. These are flagged for you to review.
4. Tap **Generate [count]** to confirm.

## After generating

The confirmation tells you how many were created, how many were **sent to AR for credit review**, and how many were **flagged for review** (a prior-month PM is still open for that equipment). From there you can jump to **View credit review** or **Review flagged**, or tap **Done**.

## Gotchas

- **Credit-hold customers are not skipped.** Their PMs are created and routed to AR. Track them on the [Credit Review](/help/managers/release-a-credit-hold) page — work won't proceed until released.
- **Flagged duplicates need a decision.** A flagged ticket means last month's PM for that machine is still open. Close it out or skip it so you're not double-billing.
- If the confirmation says some customers were **not emailed**, AR didn't get the notice — check the AR email in [Settings](/help/admin/settings) and resend from the credit review queue.
