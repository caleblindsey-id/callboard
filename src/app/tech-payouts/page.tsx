import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getAllLeads } from '@/lib/db/tech-leads'
import { getEntriesByStatus } from '@/lib/db/ace-labor'
import { getPendingCandidatesForLeads } from '@/lib/db/equipment-sale-candidates'
import { getActiveSalesReps } from '@/lib/db/sales-reps'
import { getCommissionReport, getAvailablePeriods } from '@/lib/db/commission'
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
  const commissionReport = await getCommissionReport(period)

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
        commissionReport={commissionReport}
        availablePeriods={availablePeriods}
        forcedTab={params.tab === 'commission' ? 'commission' : undefined}
      />
    </div>
  )
}
