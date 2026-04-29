import Link from 'next/link'
import ZoneHeader from './ZoneHeader'

type Props = {
  today: number
  thisWeek: number
  unscheduled: number
  monthName: string
  month: number
  year: number
}

export default function ScheduleSummary({ today, thisWeek, unscheduled, monthName, month, year }: Props) {
  return (
    <section>
      <ZoneHeader label="Schedule" />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-6 sm:gap-8">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Today</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                {today} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">PMs</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">This week</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                {thisWeek} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">PMs</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Unscheduled · {monthName}
              </div>
              <div className={`text-2xl font-bold tabular-nums ${unscheduled > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                {unscheduled}
              </div>
            </div>
          </div>
          <Link
            href={`/tickets?month=${month}&year=${year}`}
            className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
          >
            Open schedule →
          </Link>
        </div>
      </div>
    </section>
  )
}
