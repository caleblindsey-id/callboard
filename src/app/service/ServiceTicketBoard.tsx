'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { UserRow } from '@/types/database'
import { ServiceTicketWithJoins, ServiceTicketStatus, ServicePriority, ServiceTicketType } from '@/types/service-tickets'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import { SERVICE_STATUS } from '@/lib/constants/service-status'

const STATUS_OPTIONS: { value: '' | ServiceTicketStatus; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'estimated', label: 'Estimated' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'billed', label: 'Billed' },
  { value: 'declined', label: 'Declined' },
  { value: 'canceled', label: 'Canceled' },
]

const PRIORITY_OPTIONS: { value: '' | ServicePriority; label: string }[] = [
  { value: '', label: 'All Priorities' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'standard', label: 'Standard' },
  { value: 'low', label: 'Low' },
]

const TYPE_OPTIONS: { value: '' | ServiceTicketType; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
]

function PriorityBadge({ priority }: { priority: ServicePriority }) {
  const config: Record<ServicePriority, { label: string; classes: string }> = {
    emergency: {
      label: 'Emergency',
      classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    },
    standard: {
      label: 'Standard',
      classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    },
    low: {
      label: 'Low',
      classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    },
  }
  const c = config[priority]
  if (!c) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.classes}`}>
      {c.label}
    </span>
  )
}

function TypeBadge({ type }: { type: ServiceTicketType }) {
  const config: Record<ServiceTicketType, { label: string; classes: string }> = {
    inside: {
      label: 'Inside',
      classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
    },
    outside: {
      label: 'Outside',
      classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
    },
  }
  const c = config[type]
  if (!c) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.classes}`}>
      {c.label}
    </span>
  )
}

function ticketAgeDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
}

interface ServiceTicketBoardProps {
  currentUser: UserRow
}

export function ServiceTicketBoard({ currentUser }: ServiceTicketBoardProps) {
  const isTech = currentUser.role === 'technician'
  const router = useRouter()

  const [statusFilter, setStatusFilter] = useState<'' | ServiceTicketStatus>('')
  const [priorityFilter, setPriorityFilter] = useState<'' | ServicePriority>('')
  const [typeFilter, setTypeFilter] = useState<'' | ServiceTicketType>('')
  const [techFilter, setTechFilter] = useState('')
  const [waitingOnParts, setWaitingOnParts] = useState(false)

  const [tickets, setTickets] = useState<ServiceTicketWithJoins[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch('/api/users')
        if (res.ok) {
          const data = await res.json()
          setUsers(data)
        }
      } catch {
        // non-critical — tech filter just won't populate
      }
    }
    if (!isTech) fetchUsers()
  }, [isTech])

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (priorityFilter) params.set('priority', priorityFilter)
        if (typeFilter) params.set('type', typeFilter)
        if (techFilter) params.set('technicianId', techFilter)
        if (waitingOnParts) params.set('waiting_on_parts', 'true')

        const res = await fetch(`/api/service-tickets?${params.toString()}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? 'Failed to load service tickets')
          return
        }
        const data = await res.json()
        setTickets(data)
      } catch {
        setError('Failed to load service tickets')
      } finally {
        setLoading(false)
      }
    }
    fetchTickets()
  }, [statusFilter, priorityFilter, typeFilter, techFilter, waitingOnParts])

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | ServiceTicketStatus)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as '' | ServicePriority)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as '' | ServiceTicketType)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {!isTech && (
            <div className="w-full lg:w-auto">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Technician</label>
              <select
                value={techFilter}
                onChange={(e) => setTechFilter(e.target.value)}
                className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="">All Technicians</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="w-full lg:w-auto flex items-end">
            <label className="flex items-center gap-2 cursor-pointer py-1.5">
              <input
                type="checkbox"
                checked={waitingOnParts}
                onChange={(e) => setWaitingOnParts(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Waiting on Parts</span>
            </label>
          </div>

          {!isTech && (
            <div className="w-full lg:w-auto lg:ml-auto">
              <button
                onClick={() => router.push('/service/new')}
                className="w-full lg:w-auto px-4 py-2.5 lg:py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px] lg:min-h-0"
              >
                New Service Ticket
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Ticket list */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading...
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No service tickets found for the selected filters.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700 ${
                    ticket.priority === 'emergency'
                      ? 'border-l-4 border-red-500 bg-red-50/50 dark:bg-red-900/10'
                      : ''
                  }`}
                  onClick={() => router.push(`/service/${ticket.id}`)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {ticket.work_order_number ? `WO-${ticket.work_order_number}` : '—'}
                        {ticket.synergy_validation_status === 'invalid' && (
                          <AlertTriangle className="inline h-3.5 w-3.5 text-red-500 ml-1" />
                        )}
                      </span>
                      <ServiceStatusBadge status={ticket.status} />
                      <PriorityBadge priority={ticket.priority} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {ticket.customers?.name ?? '—'}
                    </p>
                    {ticket.customers?.credit_hold && <CreditHoldBadge />}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[ticket.equipment?.make, ticket.equipment?.model].filter(Boolean).join(' ') ||
                      [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') ||
                      '—'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <TypeBadge type={ticket.ticket_type} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Tech: {ticket.assigned_technician?.name ?? '—'}
                    </span>
                    {(() => {
                      const age = ticketAgeDays(ticket.created_at)
                      const isStale = age > 7 && (ticket.status === SERVICE_STATUS.OPEN || ticket.status === SERVICE_STATUS.ESTIMATED)
                      return (
                        <span className={`text-xs ${isStale ? 'text-red-500 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                          {age}d ago
                        </span>
                      )
                    })()}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Priority</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Technician</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                        ticket.priority === 'emergency'
                          ? 'bg-red-50/50 dark:bg-red-900/10'
                          : ''
                      }`}
                      onClick={() => router.push(`/service/${ticket.id}`)}
                    >
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-medium">
                        {ticket.work_order_number ? `WO-${ticket.work_order_number}` : '—'}
                        {ticket.synergy_validation_status === 'invalid' && (
                          <AlertTriangle className="inline h-3.5 w-3.5 text-red-500 ml-1" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusBadge status={ticket.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{ticket.customers?.name ?? '—'}</span>
                          {ticket.customers?.credit_hold && <CreditHoldBadge />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {[ticket.equipment?.make, ticket.equipment?.model].filter(Boolean).join(' ') ||
                          [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') ||
                          '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge type={ticket.ticket_type} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.assigned_technician?.name ?? '—'}
                      </td>
                      {(() => {
                        const age = ticketAgeDays(ticket.created_at)
                        const isStale = age > 7 && (ticket.status === SERVICE_STATUS.OPEN || ticket.status === SERVICE_STATUS.ESTIMATED)
                        return (
                          <td className={`px-4 py-3 ${isStale ? 'text-red-500 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                            {new Date(ticket.created_at).toLocaleDateString()}
                            {isStale && <span className="ml-1 text-xs">({age}d)</span>}
                          </td>
                        )
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
