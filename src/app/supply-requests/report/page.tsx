import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getSupplyRequestReport } from '@/lib/db/supply-requests'
import SupplyReportClient from './SupplyReportClient'
import PageHeader from '@/components/ui/PageHeader'

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
      <PageHeader
        title="Supply Request Report"
        subtitle="What technicians are requesting and how often."
        backHref="/supply-requests"
      />
      <SupplyReportClient report={report} range={range} />
    </div>
  )
}
