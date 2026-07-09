import {
  ClipboardList,
  UserCheck,
  Play,
  CheckCircle,
  Receipt,
  SkipForward,
  AlertTriangle,
} from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import StatusCountGrid, { type StatusCountItem } from '@/components/dashboard/StatusCountGrid'
import { getDashboardPmSummary } from '@/lib/db/tickets'
import type { TicketStatus } from '@/types/database'

const statusCards: {
  status: TicketStatus
  label: string
  icon: typeof ClipboardList
  color: string
}[] = [
  { status: 'unassigned', label: 'Unassigned', icon: ClipboardList, color: 'text-yellow-500' },
  { status: 'assigned', label: 'Assigned', icon: UserCheck, color: 'text-blue-500' },
  { status: 'in_progress', label: 'In Progress', icon: Play, color: 'text-orange-500' },
  { status: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-green-500' },
  { status: 'billed', label: 'Billed', icon: Receipt, color: 'text-purple-500' },
  { status: 'skipped', label: 'Skipped', icon: SkipForward, color: 'text-gray-400' },
  { status: 'skip_requested', label: 'Skip Requested', icon: AlertTriangle, color: 'text-amber-500' },
]

type Props = {
  month: number
  year: number
  monthName: string
}

export default async function PmStatusSection({ month, year, monthName }: Props) {
  const tickets = await getDashboardPmSummary(month, year)

  const counts: Record<TicketStatus, number> = {
    unassigned: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    billed: 0,
    skipped: 0,
    skip_requested: 0,
  }
  for (const t of tickets) counts[t.status]++

  const items: StatusCountItem[] = statusCards.map((card) => ({
    key: card.status,
    label: card.label,
    icon: card.icon,
    color: card.color,
    href: `/tickets?month=${month}&year=${year}&status=${card.status}`,
  }))

  return (
    <section>
      <ZoneHeader label={`PM Tickets — ${monthName}`} />
      <StatusCountGrid items={items} counts={counts} />
    </section>
  )
}
