import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getSupplyRequestReport } from '@/lib/db/supply-requests'
import SupplyReportClient from './SupplyReportClient'

export const dynamic = 'force-dynamic'

// Map the URL ?range= preset to a lookback window. 'all' → null (no cutoff).
const RANGE_DAYS: Record<string, number | null> = {
  '30': 30,
  '90': 90,
  '365': 365,
  all: null,
}

export default async function SupplyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  await requireRole(...MANAGER_ROLES)

  const params = await searchParams
  const range = params.range && params.range in RANGE_DAYS ? params.range : '30'
  const report = await getSupplyRequestReport(RANGE_DAYS[range])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Supply Request Report</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          What technicians are requesting and how often.
        </p>
      </div>
      <SupplyReportClient report={report} range={range} />
    </div>
  )
}
