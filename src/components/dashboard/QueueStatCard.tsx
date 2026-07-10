import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'

export type QueueStatCardProps = {
  href: string
  icon: LucideIcon
  title: string
  subtitle: string
  /** Highlights the subtitle in red when the count needs urgent attention (e.g. "needs first contact"). */
  alertSubtitle?: boolean
  count: number
}

// Shared card for the dashboard's single-stat queue zones (Estimate Follow-Up,
// Declined Estimates, Warranty Claims, Waiting on PO, Ready to Bill, Ready for
// Pickup). Replaces six byte-near-identical hand-rolled cards (dashboard-4/10).
export default function QueueStatCard({
  href,
  icon: Icon,
  title,
  subtitle,
  alertSubtitle,
  count,
}: QueueStatCardProps) {
  return (
    <Link
      href={href}
      className="block h-full bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-slate-600 dark:text-slate-300 shrink-0" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {title}
            </span>
          </div>
          <p
            className={`text-xs mt-1 ${
              alertSubtitle
                ? 'text-red-600 dark:text-red-400 font-medium'
                : 'text-slate-600/80 dark:text-slate-400'
            }`}
          >
            {subtitle}
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
  )
}
