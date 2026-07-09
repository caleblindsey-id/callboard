import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getSupplyRequestQueue } from '@/lib/db/supply-requests'
import SupplyRequestsClient from './SupplyRequestsClient'
import PageHeader from '@/components/ui/PageHeader'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function SupplyRequestsPage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getSupplyRequestQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Supply Requests"
        subtitle="Shop supplies technicians have asked the warehouse to pull and stage for pickup."
        actions={
          <Link
            href="/supply-requests/report"
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 lg:min-h-0"
            title="See what techs are requesting and how often"
          >
            <BarChart3 className="h-4 w-4" />
            Reports
          </Link>
        }
      />
      <SupplyRequestsClient rows={rows} />
    </div>
  )
}
