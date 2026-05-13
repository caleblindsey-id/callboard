import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getAllLeads } from '@/lib/db/tech-leads'
import { getEntriesByStatus } from '@/lib/db/ace-labor'
import { getPendingCandidatesForLeads } from '@/lib/db/equipment-sale-candidates'
import TechPayoutsClient from './TechPayoutsClient'

export const dynamic = 'force-dynamic'

export default async function TechPayoutsPage() {
  const user = await requireRole(...MANAGER_ROLES)
  const [leads, aceEntries] = await Promise.all([
    getAllLeads(),
    getEntriesByStatus(['pending', 'approved', 'paid', 'rejected']),
  ])

  const matchableLeadIds = leads
    .filter(l => l.lead_type === 'equipment_sale' && (l.status === 'approved' || l.status === 'match_pending'))
    .map(l => l.id)
  const candidatesByLead = await getPendingCandidatesForLeads(matchableLeadIds)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Tech Payouts</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Review tech-submitted leads and ACE labor entries, confirm Synergy sale matches, and run monthly payouts. Both lead bonuses and ACE labor roll into the same monthly report.
        </p>
      </div>
      <TechPayoutsClient
        leads={leads}
        candidatesByLead={candidatesByLead}
        aceEntries={aceEntries}
        currentUserId={user.id}
      />
    </div>
  )
}
