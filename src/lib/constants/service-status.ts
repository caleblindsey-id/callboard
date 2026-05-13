// Service ticket status constants — single source of truth for status string
// values used in comparisons across the service UI. Mirrors the
// ServiceTicketStatus union in src/types/service-tickets.ts.

export const SERVICE_STATUS = {
  OPEN: 'open',
  ESTIMATED: 'estimated',
  APPROVED: 'approved',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  BILLED: 'billed',
  DECLINED: 'declined',
  CANCELED: 'canceled',
} as const

export type ServiceStatus = typeof SERVICE_STATUS[keyof typeof SERVICE_STATUS]
