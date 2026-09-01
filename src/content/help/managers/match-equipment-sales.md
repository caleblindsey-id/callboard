---
title: Confirm or dismiss an equipment sale match
category: Managers
roles: [super_admin, manager]
order: 51
summary: How to judge a match candidate on Tech Payouts, pick the right tier, and when to dismiss instead.
last_verified: 2026-09-01
---

When a tech flags an aging machine at a customer, CallBoard watches Synergy for that customer to buy replacement equipment. A nightly scan reads the ERP at 5:35 AM and drops anything it finds into **Tech Payouts → Match Candidates**. Your job there is one decision per candidate: is this the sale the tech earned, and at what tier?

Confirming pays real money and cannot be undone, so it is worth two minutes.

## The two tabs

**Awaiting Match** holds approved equipment-sale leads with no candidate yet. Nothing to do here; the scan is watching. Each row shows when the lead expires, which is six months after it was submitted.

**Match Candidates** holds leads where the scan found at least one qualifying Synergy order. This is the queue you work.

## Working a candidate

Each candidate shows the Synergy order number, its date, the order total, and every equipment line on it: item number, description, quantity, unit price, and commodity code. Above it you see the machine the tech actually flagged.

Go in this order:

1. **Read the flagged machine.** Make, model, serial, location. That is what the sale has to replace.
2. **Find the machine on the order.** Read the line table, not the order total. A large order total proves nothing on its own.
3. **Check it is the replacement.** Same site, same category. A customer buying something unrelated is not this tech's bonus.
4. **Pick the tier from what was sold**, not from the tech's guess. The dropdown pre-fills the guess as a convenience. The tier you choose is what sets the dollar amount, and it locks permanently.

## What does not count

These are excluded by the bonus rate card, no matter what they cost:

- Vacuums of any kind, including backpacks, uprights, wet/dry and canisters
- Fans and blowers
- Carpet extractors under 10 gallon
- Batteries, chemicals, parts and consumables

The nightly scan already filters batteries and vacuums out before you see them, so most of what reaches this tab should be a real machine. Extractors and manual sweepers still come through, because the size and cord questions are judgment calls that belong to you.

## Confirm, or dismiss

**Confirm match** freezes the tier and the dollar amount onto the lead, dismisses any other candidate on it, and moves the lead to Earned ready for the next payout. This is effectively permanent: the earn and payout fields are locked by the database once a lead is earned.

**Not eligible (dismiss)** closes just that candidate. The lead goes back to Awaiting Match and keeps scanning until it expires, so nothing is lost. Add a short reason so the next person can see why.

**Dismiss all** does the same for every candidate on that lead at once.

When in doubt, dismiss. It costs nothing and the lead stays alive. Confirming the wrong order or the wrong tier is the expensive mistake.

## Matching a sale the scan did not find

On an Awaiting Match row, **Match sale** lets you attach a Synergy order by hand. Use the **order** number, not the invoice number: once an order is invoiced, Synergy files it under its order number, and an invoice number typed here will not look up later.

If the order date falls outside the lead's window, CallBoard warns you but still lets you save. That is deliberate, for the tech who submits a lead a few days after the fact. A sale that closed well before the lead was raised cannot have come from it, so treat that warning as a real question.

## Gotchas

- **A lead with no linked customer can never match.** If the tech typed a customer name as free text and nobody linked it to a Synergy account, the scan skips it and it will quietly expire. Open the lead and link the customer.
- **A dismissed order will not come back on its own.** The nightly scan never re-raises an order you have dismissed. To undo a dismissal, use **Match sale** and enter the order again.
- **The tech's tier guess is a guess.** It pre-fills the dropdown and carries no weight.
- **Cord Electric excludes vacuums, fans, and extractors under 10 gallon.** If one of those is what they bought, the answer is Not eligible, not Cord Electric.

## Related

- [Approve tech leads and create equipment](/help/managers/approve-tech-leads)
- [Run tech payouts](/help/managers/tech-payouts)
