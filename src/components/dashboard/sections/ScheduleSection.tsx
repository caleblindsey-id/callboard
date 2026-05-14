import ScheduleSummary from '@/components/dashboard/ScheduleSummary'
import { getDashboardPmSummary } from '@/lib/db/tickets'

type Props = {
  month: number
  year: number
  monthName: string
}

export default async function ScheduleSection({ month, year, monthName }: Props) {
  const tickets = await getDashboardPmSummary(month, year)

  const remaining = tickets.filter(
    (t) => t.status !== 'completed' && t.status !== 'billed' && t.status !== 'skipped'
  ).length

  return (
    <ScheduleSummary
      remaining={remaining}
      monthName={monthName}
      month={month}
      year={year}
    />
  )
}
