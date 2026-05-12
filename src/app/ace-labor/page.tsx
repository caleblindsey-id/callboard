import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getEntriesByStatus } from '@/lib/db/ace-labor'
import AceLaborClient from './AceLaborClient'

export const dynamic = 'force-dynamic'

export default async function AceLaborPage() {
  const user = await requireRole(...MANAGER_ROLES)
  // Load everything: Pending (action queue) plus Approved / Rejected / Paid
  // (history tab). Splitting happens client-side.
  const entries = await getEntriesByStatus(['pending', 'approved', 'rejected', 'paid'])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">ACE Labor</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Approve, reject, or revisit tech-submitted ACE labor on no-charge tickets. Payouts roll into the monthly report on the Tech Leads page.
        </p>
      </div>
      <AceLaborClient entries={entries} currentUserId={user.id} />
    </div>
  )
}
