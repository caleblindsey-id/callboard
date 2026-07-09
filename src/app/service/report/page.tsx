import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getServiceOpsReport } from '@/lib/db/service-reports'
import PageHeader from '@/components/ui/PageHeader'
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
      <PageHeader
        backHref="/service"
        title="Service Report"
        subtitle="Estimate win rate, warranty credit recovery, margin overrides, and PM skip trends."
      />
      <ServiceOpsReportClient report={report} range={range} />
    </div>
  )
}
