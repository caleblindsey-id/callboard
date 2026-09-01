---
title: Run tech payouts
category: Managers
roles: [super_admin, manager, coordinator]
order: 70
summary: Review ACE labor, then lock a month's lead bonuses and ACE labor, export them, and mark them paid.
last_verified: 2026-09-01
---

**Tech Payouts** covers two jobs: reviewing what techs submit, and closing out a month's pay period.

## Review ACE labor

ACE labor is no-charge work a tech still gets paid for. The tech enters the hours and a reason when they complete the ticket; it waits on your approval before it can be paid.

1. Open **Tech Payouts** and go to the **ACE Review** tab. It lists every entry still waiting, with the tech, the ticket, the hours, the rate type, and their reason.
2. Tap the ticket link if you need the full context before deciding.
3. Then pick one:
   - **Approve** — the entry is cleared for the next payout. The dollar value of the rate is snapshotted at this moment, so a later rate change won't rewrite what you approved.
   - **Edit** — correct the entry in place. The hours, rate type, and reason all become editable in the row; **Save** keeps it in the queue for you to approve. Use this when the entry is legitimate but a number is wrong.
   - **Reject** — send it back with a reason. Use this when the entry shouldn't be paid at all. The tech sees your reason on the ticket and can fix and resubmit.

You can also do all of this from the ticket itself: the **ACE Labor** card on any PM or service ticket shows the entry and gives you the same edit form.

## Close out a pay period

1. Go to the **Payout** tab and pick the month from **Period**.
2. The chip next to the controls tells you where the month stands — **draft** (recomputes on every load, so a late invoice can still move the figures), **locked** (snapshotted), or **paid**.
3. Tick **Show techs with no activity** if you want the full roster rather than just techs with earnings.
4. **Export CSV** downloads the month — lead bonuses and ACE labor together — for payroll.
5. **Lock period** freezes the figures. From then on the report is read from that snapshot rather than recalculated.
6. **Mark paid** closes the month out. It only appears once the period is locked.

## Gotchas

- **Approved and paid ACE entries can't be edited** — by anyone, including super admins. The rate is snapshotted at approval and the month may already be locked, so an edit there would move a settled number. If an approved entry is wrong, it has to be handled outside the entry itself.
- **You can't approve or reject your own ACE entry.** Someone else has to review it.
- **Editing a rejected entry puts it back in the queue.** That's how you undo a rejection you've changed your mind about — the rejection reason clears and the entry returns to ACE Review as pending.
- **Lock before you pay.** **Mark paid** only shows up on a locked period; a draft month is still moving.
- **Locking is manager and super admin only**; only a super admin can **Reopen** a locked month.
- **Drift is a warning, not a problem.** If Synergy totals move after a lock, a banner names the affected techs. It changes nothing about what gets paid — it means dollars arrived after the close.
