import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import { getPendingEstimateCounts } from '@/lib/db/estimate-queue'

export default async function EstimateFollowUpSection() {
  const counts = await getPendingEstimateCounts()
  if (counts.total === 0) return null

  const subtitle =
    counts.needsFirstContact > 0
      ? `${counts.needsFirstContact} need first contact`
      : 'All contacted — following up for a decision'

  return (
    <section>
      <ZoneHeader label="Estimate Follow-Up" />
      <Link
        href="/estimate-queue"
        className="block bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Estimates awaiting a customer decision
              </span>
            </div>
            <p
              className={`text-xs mt-1 ${
                counts.needsFirstContact > 0
                  ? 'text-red-600 dark:text-red-400 font-medium'
                  : 'text-slate-600/80 dark:text-slate-400'
              }`}
            >
              {subtitle}
            </p>
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
