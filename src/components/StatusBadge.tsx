import { TicketStatus } from '@/types/database'

const statusConfig: Record<TicketStatus, { label: string; classes: string }> = {
  unassigned: {
    label: 'Unassigned',
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  },
  assigned: {
    label: 'Assigned',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  in_progress: {
    label: 'In Progress',
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  billed: {
    label: 'Billed',
    classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  },
  skipped: {
    label: 'Skipped',
    classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  },
}

export default function StatusBadge({ status }: { status: TicketStatus }) {
  const config = statusConfig[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  )
}
