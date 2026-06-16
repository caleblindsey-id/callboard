import Link from 'next/link'
import { ChevronRight, ShieldCheck } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import { getWarrantyClaimCounts } from '@/lib/db/warranty-queue'

export default async function WarrantyClaimsSection() {
  const counts = await getWarrantyClaimCounts()
  if (counts.actionable === 0) return null

  const parts: string[] = []
  if (counts.toFile > 0) parts.push(`${counts.toFile} to file`)
  if (counts.awaitingCredit > 0) parts.push(`${counts.awaitingCredit} awaiting credit`)

  return (
    <section>
      <ZoneHeader label="Warranty Claims" />
      <Link
        href="/warranty-queue"
        className="block bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Warranty claims to work
              </span>
            </div>
            <p className="text-xs mt-1 text-slate-600/80 dark:text-slate-400">
              {parts.join(' · ') || 'File claims and log vendor credits'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-2xl font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {counts.actionable}
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </div>
        </div>
      </Link>
    </section>
  )
}
