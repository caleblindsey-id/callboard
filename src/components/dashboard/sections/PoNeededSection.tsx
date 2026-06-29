import Link from 'next/link'
import { ChevronRight, ClipboardList } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import { getPoNeededCount } from '@/lib/db/service-tickets'

export default async function PoNeededSection() {
  const count = await getPoNeededCount()
  if (count === 0) return null

  return (
    <section>
      <ZoneHeader label="Waiting on PO" />
      <Link
        href="/service?status=completed&poNeeded=1"
        className="block bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Completed jobs waiting on a customer PO
              </span>
            </div>
            <p className="text-xs mt-1 text-slate-600/80 dark:text-slate-400">
              Enter the customer PO so these can be billed
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-2xl font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {count}
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </div>
        </div>
      </Link>
    </section>
  )
}
