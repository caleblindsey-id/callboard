import { getServiceTicket } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getLaborRate } from '@/lib/db/settings'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import { ServiceTicketDetail } from './ServiceTicketDetail'
import type { ServiceTicketStatus } from '@/types/service-tickets'

const WORKFLOW_STEPS: ServiceTicketStatus[] = ['open', 'estimated', 'approved', 'in_progress', 'completed', 'billed']
const STEP_LABELS: Record<string, string> = {
  open: 'Open',
  estimated: 'Estimated',
  approved: 'Approved',
  in_progress: 'In Progress',
  completed: 'Completed',
  billed: 'Billed',
}

export default async function ServiceTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [ticket, user] = await Promise.all([
    getServiceTicket(id),
    getCurrentUser(),
  ])

  if (!user) redirect('/login')
  if (!ticket) notFound()

  // Techs can only see their own assigned tickets
  if (isTechnician(user.role) && ticket.assigned_technician_id !== user.id) {
    redirect('/')
  }

  const laborRate = await getLaborRate(ticket.labor_rate_type ?? 'standard')

  const equipmentLabel = ticket.equipment
    ? [ticket.equipment.make, ticket.equipment.model].filter(Boolean).join(' ')
    : [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') || null

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/service"
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 transition-colors p-3 -m-3 rounded-md"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
              Service Ticket
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {ticket.work_order_number ? `WO-${ticket.work_order_number}` : 'No WO#'}
              {' — '}
              {ticket.customers?.name ?? 'Unknown Customer'}
              {equipmentLabel ? ` — ${equipmentLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="pl-8 sm:pl-0 sm:ml-auto">
          <ServiceStatusBadge status={ticket.status} />
        </div>
      </div>

      {/* Workflow progression indicator */}
      {WORKFLOW_STEPS.includes(ticket.status) && (() => {
        const currentStep = WORKFLOW_STEPS.indexOf(ticket.status)
        return (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {WORKFLOW_STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      i < currentStep
                        ? 'bg-slate-500 dark:bg-slate-400'
                        : i === currentStep
                          ? 'bg-slate-800 dark:bg-white ring-2 ring-slate-300 dark:ring-slate-600'
                          : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  />
                  <span
                    className={`text-xs hidden sm:inline whitespace-nowrap ${
                      i <= currentStep
                        ? 'text-slate-700 dark:text-gray-300 font-medium'
                        : 'text-gray-400 dark:text-gray-600'
                    }`}
                  >
                    {STEP_LABELS[step]}
                  </span>
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div
                    className={`h-px flex-1 min-w-3 ${
                      i < currentStep
                        ? 'bg-slate-400 dark:bg-slate-500'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        )
      })()}

      <ServiceTicketDetail
        ticket={ticket}
        userRole={user.role}
        userId={user.id}
        laborRate={laborRate}
      />
    </div>
  )
}
