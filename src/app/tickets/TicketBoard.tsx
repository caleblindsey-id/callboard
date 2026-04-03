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
}

export default function TicketBoard({
  tickets,
  users,
  currentMonth,
  currentYear,
  userRole,
}: TicketBoardProps) {
  const isManager = userRole === 'manager' || userRole === 'coordinator'
  const router = useRouter()
  const thisYear = new Date().getFullYear()

  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)
  const [techFilter, setTechFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
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
    if (typeFilter) params.set('type', typeFilter)
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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {isManager && (
            <div className="w-full lg:w-auto">
              <label className="block text-xs font-medium text-gray-600 mb-1">Technician</label>
              <select
                value={techFilter}
                onChange={(e) => setTechFilter(e.target.value)}
                className="w-full lg:w-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="">All Technicians</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full lg:w-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full lg:w-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="">All Types</option>
              <option value="pm">PM</option>
              <option value="service_request">Service Request</option>
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
                className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
              >
                New Ticket
              </button>
              <button
                onClick={() => setGenerateOpen(true)}
                className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
              >
                Generate {MONTHS[month - 1]} PMs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Bulk assign — managers only */}
      {isManager && selected.size > 0 && (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 flex items-center gap-3">
          <span className="text-sm text-blue-800 font-medium">
            {selected.size} ticket{selected.size > 1 ? 's' : ''} selected
          </span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="">Assign to...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={!assignTo || bulkLoading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? 'Assigning...' : 'Assign'}
          </button>
          <button
            onClick={handleSkipSelected}
            disabled={bulkLoading}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? 'Processing...' : 'Skip Selected'}
          </button>
        </div>
      )}

      {/* Ticket list */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No tickets found for the selected filters.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50"
                  onClick={() => router.push(`/tickets/${ticket.id}`)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">WO-{ticket.work_order_number}</span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {ticket.customers?.name ?? '—'}
                        {ticket.ticket_type === 'service_request' && (
                          <span className="text-xs text-orange-600 ml-1">(SR)</span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">
                    {[ticket.equipment?.make, ticket.equipment?.model]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
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
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {isManager && (
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={selected.size === tickets.length && tickets.length > 0}
                          onChange={toggleAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left font-medium text-gray-600">WO #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Equipment</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">City</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Scheduled Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Technician</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className="hover:bg-gray-50 cursor-pointer"
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
                            className="rounded border-gray-300"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600 font-medium">
                        WO-{ticket.work_order_number}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {ticket.customers?.name ?? '—'}
                        {ticket.ticket_type === 'service_request' && (
                          <span className="text-xs text-orange-600 ml-1">(SR)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {[ticket.equipment?.make, ticket.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {ticket.equipment?.ship_to_locations?.city ?? ticket.customers?.billing_city ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {ticket.scheduled_date
                          ? new Date(ticket.scheduled_date).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
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
