import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getAllLeads } from '@/lib/db/tech-leads'
import { getEntriesByStatus } from '@/lib/db/ace-labor'
import { getPendingCandidatesForLeads } from '@/lib/db/equipment-sale-candidates'
import { getActiveSalesReps } from '@/lib/db/sales-reps'
import { getCommissionReport, getAvailablePeriods } from '@/lib/db/commission'
import { getPayoutPeriod, getLockedReport, detectDrift } from '@/lib/db/payouts'
import { lockBlockers, lockWarnings } from '@/lib/payouts/manifest'
import { monthKeyInZone } from '@/lib/business-time'
import TechPayoutsClient from './TechPayoutsClient'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function TechPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>
}) {
  const user = await requireRole(...MANAGER_ROLES)
  const params = await searchParams

  const [leads, aceEntries, salesReps, availablePeriods] = await Promise.all([
    getAllLeads(),
    getEntriesByStatus(['pending', 'approved', 'paid', 'rejected']),
    getActiveSalesReps(),
    getAvailablePeriods(),
  ])

  // Default to the newest synced period, falling back to the current Central
  // month. Validated against a regex before it reaches a query, and the report
  // itself surfaces an empty state rather than pretending zero is an answer.
  const requested = params.period && PERIOD_RE.test(params.period) ? params.period : null
  const period = requested ?? availablePeriods[0] ?? monthKeyInZone(new Date())

  // A locked period is READ FROM ITS SNAPSHOT, not recomputed. That is the
  // whole point of locking: the 5:45 AM labor sync, a reopened ticket, or a
  // late ACE approval can no longer move a month that has been closed.
  //
  // The live figures are still computed for a locked period, but only to
  // compare against. Drift changes nothing about what gets paid; it is the
  // signal that something arrived late and now belongs to the next open period.
  const liveReport = await getCommissionReport(period)
  const periodState = await getPayoutPeriod(period)
  const isLocked = periodState.status !== 'draft'
  const commissionReport = isLocked ? await getLockedReport(period, liveReport) : liveReport
  const drift = isLocked ? detectDrift(commissionReport, liveReport) : []

  const matchableLeadIds = leads
    .filter(l => l.lead_type === 'equipment_sale' && (l.status === 'approved' || l.status === 'match_pending'))
    .map(l => l.id)
  const candidatesByLead = await getPendingCandidatesForLeads(matchableLeadIds)

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Tech Payouts"
        subtitle="Review tech-submitted leads and ACE labor entries, confirm Synergy sale matches, and run monthly payouts. Both lead bonuses and ACE labor roll into the same monthly report."
      />
      <TechPayoutsClient
        leads={leads}
        candidatesByLead={candidatesByLead}
        aceEntries={aceEntries}
        salesReps={salesReps}
        currentUserId={user.id}
        currentUserRole={user.role}
        payoutReport={commissionReport}
        availablePeriods={availablePeriods}
        periodState={periodState}
        drift={drift}
        lockBlockers={isLocked ? [] : lockBlockers(liveReport)}
        lockWarnings={isLocked ? [] : lockWarnings(liveReport)}
        // ?tab=commission is the old link, still honoured so a bookmark or an
        // in-flight email lands on the tab that replaced it.
        forcedTab={params.tab === 'payout' || params.tab === 'commission' ? 'payout' : undefined}
      />
    </div>
  )
}
