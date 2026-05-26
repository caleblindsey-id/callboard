import Link from 'next/link'
import { ChevronRight, Receipt } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import { getReadyToBillCounts } from '@/lib/db/dashboard-metrics'

export default async function ReadyToBillSection() {
  const counts = await getReadyToBillCounts()
  const total = counts.pmCount + counts.serviceCount
  if (total === 0) return null

  const totalAmount = counts.pmAmount + counts.serviceAmount

  return (
    <section>
      <ZoneHeader label="Ready to Bill" />
      <Link
        href="/billing"
        className="block bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Ready to Bill into Synergy
              </span>
            </div>
            <p className="text-xs text-slate-600/80 dark:text-slate-400 mt-1">
              PM {counts.pmCount} · Service {counts.serviceCount} · ${totalAmount.toFixed(2)} total
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-2xl font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {total}
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </div>
        </div>
      </Link>
    </section>
  )
}
