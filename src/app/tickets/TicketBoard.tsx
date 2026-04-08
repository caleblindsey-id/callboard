'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { TicketWithJoins } from '@/lib/db/tickets'
import { UserRow, TicketStatus } from '@/types/database'
import StatusBadge from '@/components/StatusBadge'
import ConfirmDialog from '@/components/ConfirmDialog'
import CreateTicketModal from './CreateTicketModal'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_OPTIONS: { value: '' | TicketStatus; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'billed', label: 'Billed' },
  { value: 'skipped', label: 'Skipped' },
]

interface TicketBoardProps {
  tickets: TicketWithJoins[]
  users: UserRow[]
  currentMonth: number
  currentYear: number
  userRole: import('@/types/database').UserRole | null
  initialStatus?: string
}

export default function TicketBoard({
  tickets,
  users,
  currentMonth,
  currentYear,
  userRole,
  initialStatus = '',
}: TicketBoardProps) {
  const isManager = userRole === 'manager' || userRole === 'coordinator'
  const router = useRouter()
  const thisYear = new Date().getFullYear()

  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)
  const [techFilter, setTechFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyFilters() {
    const params = new URLSearchParams()
    params.set('month', month.toString())
    params.set('year', year.toString())
    if (techFilter) params.set('tech', techFilter)
    if (statusFilter) params.set('status', statusFilter)
    router.push(`/tickets?${params.toString()}`)
  }

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === tickets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tickets.map((t) => t.id)))
    }
  }

  async function handleBulkAssign() {
    if (!assignTo || selected.size === 0) return
    setBulkLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tickets/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: Array.from(selected),
          technicianId: assignTo,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to assign tickets')
        return
      }
      setSelected(new Set())
      setAssignTo('')
      router.refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleSkipSelected() {
    if (selected.size === 0) return
    setBulkLoading(true)
    setError(null)
    try {
      const promises = Array.from(selected).map((ticketId) =>
        fetch(`/api/tickets/${ticketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'skipped' }),
        })
      )
      const results = await Promise.all(promises)
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        setError(`${failed.length} ticket(s) could not be skipped (may already be in progress)`)
      }
      setSelected(new Set())
      router.refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleGenerate() {
    setGenerateLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tickets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to generate tickets')
        return
      }
      router.push(`/tickets?month=${month}&year=${year}`)
    } finally {
      setGenerateLoading(false)
      setGenerateOpen(false)
    }
  }

  return (
    <>
      {/* Filters — stacked on mobile, row on desktop */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {isManager && (
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
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="w-full lg:w-auto px-4 py-2.5 lg:py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px] lg:min-h-0"
          >
            Apply
          </button>
          {isManager && (
            <div className="w-full lg:w-auto lg:ml-auto flex gap-2">
              <button
                onClick={() => setCreateOpen(true)}
                className="w-full lg:w-auto px-4 py-2.5 lg:py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px] lg:min-h-0"
              >
                New Ticket
              </button>
              <button
                onClick={() => setGenerateOpen(true)}
                className="w-full lg:w-auto px-4 py-2.5 lg:py-1.5 text-sm font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-gray-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 transition-colors min-h-[44px] lg:min-h-0"
              >
                Generate {MONTHS[month - 1]} PMs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Bulk assign — managers only */}
      {isManager && selected.size > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className="text-sm text-blue-800 dark:text-blue-300 font-medium">
            {selected.size} ticket{selected.size > 1 ? 's' : ''} selected
          </span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="w-full sm:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0"
          >
            <option value="">Assign to...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleBulkAssign}
              disabled={!assignTo || bulkLoading}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {bulkLoading ? 'Assigning...' : 'Assign'}
            </button>
            <button
              onClick={handleSkipSelected}
              disabled={bulkLoading}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {bulkLoading ? 'Processing...' : 'Skip Selected'}
            </button>
          </div>
        </div>
      )}

      {/* Ticket list */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No tickets found for the selected filters.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700"
                  onClick={() => router.push(`/tickets/${ticket.id}`)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">WO-{ticket.work_order_number}</span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {ticket.customers?.name ?? '—'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[ticket.equipment?.make, ticket.equipment?.model]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Scheduled:{' '}
                    {ticket.scheduled_date
                      ? new Date(ticket.scheduled_date).toLocaleDateString()
                      : '—'}{' '}
                    · Tech: {ticket.users?.name ?? '—'}
                    {(ticket.equipment?.ship_to_locations?.city || ticket.customers?.billing_city) && (
                      <> · City: {ticket.equipment?.ship_to_locations?.city ?? ticket.customers?.billing_city}</>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    {isManager && (
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={selected.size === tickets.length && tickets.length > 0}
                          onChange={toggleAll}
                          className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">City</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Scheduled Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Technician</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      onClick={() => router.push(`/tickets/${ticket.id}`)}
                    >
                      {isManager && (
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(ticket.id)}
                            onChange={() => toggleSelect(ticket.id)}
                            className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-medium">
                        WO-{ticket.work_order_number}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {ticket.customers?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {[ticket.equipment?.make, ticket.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.equipment?.ship_to_locations?.city ?? ticket.customers?.billing_city ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.scheduled_date
                          ? new Date(ticket.scheduled_date).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.users?.name ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={generateOpen}
        title="Generate PM Tickets"
        message={`This will create PM tickets for all active schedules in ${MONTHS[month - 1]} ${year}. Existing tickets for this month will not be duplicated.`}
        confirmLabel="Generate"
        onConfirm={handleGenerate}
        onCancel={() => setGenerateOpen(false)}
        loading={generateLoading}
      />

      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  )
}
