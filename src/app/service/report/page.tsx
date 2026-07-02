import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getServiceOpsReport } from '@/lib/db/service-reports'
import ServiceOpsReportClient from './ServiceOpsReportClient'

export const dynamic = 'force-dynamic'

// Map the URL ?range= preset to a lookback window. 'all' → null (no cutoff).
// Mirrors /supply-requests/report.
const RANGE_DAYS: Record<string, number | null> = {
  '30': 30,
  '90': 90,
  '365': 365,
  all: null,
}

export default async function ServiceOpsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  await requireRole(...MANAGER_ROLES)

  const params = await searchParams
  const range = params.range && params.range in RANGE_DAYS ? params.range : '90'
  const report = await getServiceOpsReport(RANGE_DAYS[range])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Service Report</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Estimate win rate, warranty credit recovery, margin overrides, and PM skip trends.
        </p>
      </div>
      <ServiceOpsReportClient report={report} range={range} />
    </div>
  )
}
