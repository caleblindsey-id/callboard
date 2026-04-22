import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getAllLeads } from '@/lib/db/tech-leads'
import TechLeadsClient from './TechLeadsClient'

export const dynamic = 'force-dynamic'

export default async function TechLeadsPage() {
  await requireRole(...MANAGER_ROLES)
  const leads = await getAllLeads()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Tech Leads</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Review tech-submitted PM leads, create equipment from approved leads, and run monthly bonus payouts.
        </p>
      </div>
      <TechLeadsClient leads={leads} />
    </div>
  )
}
