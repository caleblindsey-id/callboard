import type { ServiceTicketStatus } from '@/types/service-tickets'

const statusConfig: Record<ServiceTicketStatus, { label: string; classes: string }> = {
  open: {
    label: 'Open',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  estimated: {
    label: 'Estimated',
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  },
  in_progress: {
    label: 'In Progress',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  billed: {
    label: 'Billed',
    classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  declined: {
    label: 'Declined',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  canceled: {
    label: 'Canceled',
    classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  },
}

export default function ServiceStatusBadge({ status }: { status: ServiceTicketStatus }) {
  const config = statusConfig[status]
  if (!config) return null
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  )
}
