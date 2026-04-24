import { getTickets } from '@/lib/db/tickets'
import { getUsers } from '@/lib/db/users'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { TicketStatus } from '@/types/database'
import TicketBoard from './TicketBoard'

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; tech?: string; status?: string; overdue?: string; skipRequested?: string }>
}) {
  const params = await searchParams
  const now = new Date()
  const month = params.month ? parseInt(params.month) : now.getMonth() + 1
  const year = params.year ? parseInt(params.year) : now.getFullYear()
  const overdueMode = params.overdue === '1'
  const skipRequestedMode = params.skipRequested === '1'

  const user = await getCurrentUser()
  const isTech = isTechnician(user?.role ?? null)

  const monthFilters: Parameters<typeof getTickets>[0] = { month, year }
  if (isTech && user) {
    monthFilters!.technicianId = user.id
  } else if (params.tech) {
    monthFilters!.technicianId = params.tech
  }
  if (params.status) monthFilters!.status = params.status as TicketStatus

  const overdueFilters: Parameters<typeof getTickets>[0] = { overdueOnly: true, now }
  if (isTech && user) {
    overdueFilters!.technicianId = user.id
  } else if (params.tech) {
    overdueFilters!.technicianId = params.tech
  }

  const skipRequestedFilters: Parameters<typeof getTickets>[0] = { status: 'skip_requested' }
  if (isTech && user) {
    skipRequestedFilters!.technicianId = user.id
  } else if (params.tech) {
    skipRequestedFilters!.technicianId = params.tech
  }

  let monthTickets: Awaited<ReturnType<typeof getTickets>> = []
  let overdueTickets: Awaited<ReturnType<typeof getTickets>> = []
  let users: Awaited<ReturnType<typeof getUsers>> = []
  let fetchError = false
  try {
    ;[monthTickets, overdueTickets, users] = await Promise.all([
      overdueMode
        ? Promise.resolve([])
        : skipRequestedMode
          ? getTickets(skipRequestedFilters)
          : getTickets(monthFilters),
      skipRequestedMode ? Promise.resolve([]) : getTickets(overdueFilters),
      getUsers(true),
    ])
  } catch {
    fetchError = true
  }

  return (
    <div className="p-6 space-y-6">
      {fetchError && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-md px-4 py-3 text-sm">
          Unable to load tickets. Check your connection and refresh the page.
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Preventive Maintenance</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Monthly PM ticket board
        </p>
      </div>
      <TicketBoard
        tickets={monthTickets}
        overdueTickets={overdueTickets}
        users={users}
        currentMonth={month}
        currentYear={year}
        userRole={user?.role ?? null}
        initialStatus={params.status ?? ''}
        overdueMode={overdueMode}
        skipRequestedMode={skipRequestedMode}
      />
    </div>
  )
}
