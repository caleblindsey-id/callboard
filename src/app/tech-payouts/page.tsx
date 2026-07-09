import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getAllLeads } from '@/lib/db/tech-leads'
import { getEntriesByStatus } from '@/lib/db/ace-labor'
import { getPendingCandidatesForLeads } from '@/lib/db/equipment-sale-candidates'
import { getActiveSalesReps } from '@/lib/db/sales-reps'
import TechPayoutsClient from './TechPayoutsClient'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

export default async function TechPayoutsPage() {
  const user = await requireRole(...MANAGER_ROLES)
  const [leads, aceEntries, salesReps] = await Promise.all([
    getAllLeads(),
    getEntriesByStatus(['pending', 'approved', 'paid', 'rejected']),
    getActiveSalesReps(),
  ])

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
      />
    </div>
  )
}
