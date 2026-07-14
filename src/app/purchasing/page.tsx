import Link from 'next/link'
import { Plus, AlertTriangle } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { listSessions } from '@/lib/db/reorder'
import PageHeader from '@/components/ui/PageHeader'
import PurchasingList from './PurchasingList'

// Top-level, sidebar-reachable list page — follows the CallBoard Page Shell
// Standard (flat p-6 space-y-6, PageHeader), same as /service and /tickets.
export default async function PurchasingPage() {
  await requireRole(...PURCHASING_ROLES)
  const sessions = await listSessions()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Purchasing"
        subtitle="Reorder walks for the Warehouse 4 service stockroom"
        actions={
          <>
            <Link
              href="/purchasing/new?scope=below_rop"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 lg:min-h-0"
            >
              <AlertTriangle className="h-4 w-4" />
              Below Reorder Point
            </Link>
            <Link
              href="/purchasing/new"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 lg:min-h-0"
            >
              <Plus className="h-4 w-4" />
              New Reorder Walk
            </Link>
          </>
        }
      />
      <PurchasingList sessions={sessions} />
    </div>
  )
}
