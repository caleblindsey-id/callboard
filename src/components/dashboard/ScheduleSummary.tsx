import Link from 'next/link'
import ZoneHeader from './ZoneHeader'
import { ACTIONS } from '@/lib/labels'

type Props = {
  remaining: number
  monthName: string
  month: number
  year: number
}

export default function ScheduleSummary({ remaining, monthName, month, year }: Props) {
  return (
    <section>
      <ZoneHeader label="PM Workload" />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              PMs remaining · {monthName}
            </div>
            <div className={`text-2xl font-bold tabular-nums ${remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
              {remaining}
            </div>
          </div>
          <Link
            href={`/tickets?month=${month}&year=${year}`}
            className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
          >
            {ACTIONS.viewAll} →
          </Link>
        </div>
      </div>
    </section>
  )
}
