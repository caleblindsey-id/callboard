import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { getSession, getSessionLines, getSessionVendors } from '@/lib/db/reorder'
import BackButton from '@/components/BackButton'
import ReorderStatusBadge from '@/components/ReorderStatusBadge'
import ReorderWalk from './ReorderWalk'

// Detail/workflow page keyed by id (like /service/[id], /tickets/[id]) — uses
// the responsive p-4 lg:p-6 + BackButton convention those pages already use,
// not the flat list-page shell (that standard targets top-level, sidebar-
// reachable pages like /purchasing itself).
export default async function ReorderWalkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireRole(...PURCHASING_ROLES)

  const session = await getSession(id)
  if (!session) notFound()

  const [lines, vendors] = await Promise.all([
    getSessionLines(id),
    getSessionVendors(id),
  ])

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/purchasing" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl lg:text-2xl font-semibold text-gray-900 dark:text-white truncate">
            {session.name}
          </h1>
        </div>
        <ReorderStatusBadge status={session.status} />
      </div>

      <ReorderWalk session={session} initialLines={lines} vendors={vendors} currentUserId={user.id} />
    </div>
  )
}
