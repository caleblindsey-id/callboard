import { getOpenWorkCounts, getMtdRevenue } from '@/lib/db/dashboard-metrics'

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// Tech "My Day" KPI strip — persistent above the tabs (PM + service combined).
export default async function TechKpiSection({ userId }: { userId: string }) {
  const [openWork, mtd] = await Promise.all([
    getOpenWorkCounts(userId),
    getMtdRevenue(userId),
  ])

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="block rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 p-4">
        <div className="text-xs uppercase tracking-wide font-medium text-blue-700 dark:text-blue-300">
          My Open Work
        </div>
        <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
          {openWork.total}
        </div>
        <div className="text-xs text-blue-700/70 dark:text-blue-300/70 mt-1">PM + service</div>
      </div>
      <div className="block rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-4">
        <div className="text-xs uppercase tracking-wide font-medium text-emerald-700 dark:text-emerald-300">
          My MTD Revenue
        </div>
        <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
          {fmtMoney(mtd.total)}
        </div>
        {mtd.service > 0 && (
          <div className="text-xs text-emerald-700/70 dark:text-emerald-300/70 mt-1 tabular-nums">
            PM {fmtMoney(mtd.pm)} · Svc {fmtMoney(mtd.service)}
          </div>
        )}
      </div>
    </div>
  )
}
