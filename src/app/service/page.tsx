import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { ServiceTicketBoard } from './ServiceTicketBoard'

export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    priority?: string
    type?: string
    tech?: string
    waitingOnParts?: string
    poNeeded?: string
    deleted?: string
    search?: string
  }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const params = await searchParams
  // Seed the board's filters from the URL so the Back button (and dashboard
  // deep links like /service?status=open) restore the filtered view.
  const initialFilters = {
    status: params.status ?? '',
    priority: params.priority ?? '',
    type: params.type ?? '',
    tech: params.tech ?? '',
    waitingOnParts: params.waitingOnParts ?? '',
    poNeeded: params.poNeeded ?? '',
    deleted: params.deleted ?? '',
    search: params.search ?? '',
  }
  // Both office staff AND techs can access (techs see their own tickets only)
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Service Tickets</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            On-demand service requests — inside shop and field calls
          </p>
        </div>
        {user.role && MANAGER_ROLES.includes(user.role) && (
          <Link
            href="/service/report"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shrink-0"
          >
            <BarChart3 className="h-4 w-4" />
            Report
          </Link>
        )}
      </div>
      <ServiceTicketBoard currentUser={user} initialFilters={initialFilters} />
    </div>
  )
}
