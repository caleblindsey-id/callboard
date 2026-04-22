import { requireRole } from '@/lib/auth'
import { getMyLeads } from '@/lib/db/tech-leads'
import MyLeadsClient from './MyLeadsClient'

export const dynamic = 'force-dynamic'

export default async function MyLeadsPage() {
  const user = await requireRole('technician', 'manager', 'super_admin', 'coordinator')
  const leads = await getMyLeads(user.id)

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">My Leads</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Submit new PM leads and track your bonus status.
        </p>
      </div>
      <MyLeadsClient leads={leads} />
    </div>
  )
}
