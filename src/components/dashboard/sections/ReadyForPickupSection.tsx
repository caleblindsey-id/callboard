import Link from 'next/link'
import { ChevronRight, PackageCheck } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import { getReadyForPickupCounts } from '@/lib/db/dashboard-metrics'

export default async function ReadyForPickupSection() {
  const counts = await getReadyForPickupCounts()
  if (counts.total === 0) return null

  const parts: string[] = []
  if (counts.needsCall > 0) parts.push(`Needs call ${counts.needsCall}`)
  if (counts.aged30 > 0) parts.push(`30+ days ${counts.aged30}`)
  const subtitle = parts.length > 0 ? parts.join(' · ') : 'Awaiting customer pickup'

  return (
    <section>
      <ZoneHeader label="Ready for Pickup" />
      <Link
        href="/pickup-queue"
        className="block bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Equipment awaiting customer pickup
              </span>
            </div>
            <p className="text-xs text-slate-600/80 dark:text-slate-400 mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-2xl font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {counts.total}
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </div>
        </div>
      </Link>
    </section>
  )
}
