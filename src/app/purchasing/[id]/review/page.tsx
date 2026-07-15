import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { getSession, getSessionLines, getSessionVendors } from '@/lib/db/reorder'
import { getUser } from '@/lib/db/users'
import { createClient } from '@/lib/supabase/server'
import type { InvVendorRow } from '@/types/reorder'
import BackButton from '@/components/BackButton'
import ReorderStatusBadge from '@/components/ReorderStatusBadge'
import ReorderFreshness from '@/components/ReorderFreshness'
import ReorderReview from './ReorderReview'

// Detail/workflow page keyed by id, same shell convention as the walk page
// (/purchasing/[id]/page.tsx) it links back to.
export default async function ReorderReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireRole(...PURCHASING_ROLES)

  const session = await getSession(id)
  if (!session) notFound()

  const [allLines, sessionVendors] = await Promise.all([
    getSessionLines(id),
    getSessionVendors(id),
  ])
  const lines = allLines.filter((l) => l.order_qty > 0)

  // Vendor order minimums live on inv_vendors (the synced ERP master), not on
  // reorder_session_vendors — batch-fetch only the codes present on this walk.
  const vendorCodes = Array.from(
    new Set(lines.map((l) => l.vendor_code).filter((c): c is number => c != null))
  )
  let vendorMasters: InvVendorRow[] = []
  if (vendorCodes.length > 0) {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('inv_vendors')
      .select('*')
      .in('vendor_code', vendorCodes)
    if (error) throw error
    vendorMasters = (data ?? []) as InvVendorRow[]
  }

  const buyer = session.created_by_id ? await getUser(session.created_by_id) : null

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref={`/purchasing/${id}`} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl lg:text-2xl font-semibold text-gray-900 dark:text-white truncate">
            {session.name}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Review, grouped by vendor</p>
          <ReorderFreshness inventoryAsOf={session.inventory_as_of} />
        </div>
        <ReorderStatusBadge status={session.status} />
      </div>

      <ReorderReview
        session={session}
        initialLines={lines}
        initialSessionVendors={sessionVendors}
        vendorMasters={vendorMasters}
        buyerName={buyer?.name ?? null}
        currentUserId={user.id}
      />
    </div>
  )
}
