import type { TechLeadStatus } from '@/types/database'

// Canonical labels for the tech-lead pipeline states surfaced on the manager
// dashboard's "Tech Leads" card (PipelineAndMoney). DB status values stay the
// enum ('pending', 'approved', 'match_pending'); these are the words a
// manager should read next to each count.
//
// Fixes audit finding dashboard-2: the card used to label the 'pending' tile
// "Submitted" and the 'approved' tile "Pending" — visually fine on their own,
// but a manager reading "Pending: 18" was actually looking at APPROVED leads
// (awaiting match/equipment), and "Submitted: 0" was leads still awaiting
// office review. The fix keeps the labels literal: pending = still awaiting
// office review = "Submitted"; approved = office signed off, awaiting
// match/equipment = "Approved".
//
// NOTE: this is intentionally a DIFFERENT convention than the tech-payouts
// hub's own STATUS_LABEL (src/app/tech-payouts/TechPayoutsClient.tsx), which
// relabels 'approved' as "pending" for payout-hub context (manager-approved
// but awaiting payout — a different reading for a different audience).
// Reconciling the two vocabularies is scoped to the terminology sweep round,
// not this fix — see PLAN.md Round 4.
export const TECH_LEAD_PIPELINE_LABEL: Record<
  Extract<TechLeadStatus, 'pending' | 'approved' | 'match_pending'>,
  string
> = {
  pending: 'Submitted',
  approved: 'Approved',
  match_pending: 'Match Pending',
}
