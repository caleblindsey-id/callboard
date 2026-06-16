import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
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
    deleted: params.deleted ?? '',
    search: params.search ?? '',
  }
  // Both office staff AND techs can access (techs see their own tickets only)
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Service Tickets</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          On-demand service requests — inside shop and field calls
        </p>
      </div>
      <ServiceTicketBoard currentUser={user} initialFilters={initialFilters} />
    </div>
  )
}
