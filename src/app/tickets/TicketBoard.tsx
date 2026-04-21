'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronDown, AlertOctagon } from 'lucide-react'
import { TicketWithJoins } from '@/lib/db/tickets'
import { UserRow, TicketStatus, MANAGER_ROLES } from '@/types/database'
import StatusBadge, { OverdueBadge } from '@/components/StatusBadge'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import { daysOverdue } from '@/lib/overdue'
import CreateTicketModal from './CreateTicketModal'
import GeneratePmModal from './GeneratePmModal'
import SkipDialog from './SkipDialog'

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
  { value: 'skip_requested', label: 'Skip Requested' },
]

interface TicketBoardProps {
  tickets: TicketWithJoins[]
  overdueTickets: TicketWithJoins[]
  users: UserRow[]
  currentMonth: number
  currentYear: number
  userRole: import('@/types/database').UserRole | null
  initialStatus?: string
  overdueMode?: boolean
}

interface TicketListProps {
  tickets: TicketWithJoins[]
  isManager: boolean
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleAll: () => void
  showOverdueBadges?: boolean
  emptyMessage: string
}

function TicketList({
  tickets,
  isManager,
  selected,
  onToggleSelect,
  onToggleAll,
  showOverdueBadges = false,
  emptyMessage,
}: TicketListProps) {
  const router = useRouter()
  if (tickets.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {emptyMessage}
      </div>
    )
  }

  return (
    <>
      <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {tickets.map((ticket) => {
          const days = showOverdueBadges ? daysOverdue(ticket) : 0
          return (
            <div
              key={ticket.id}
              className={`px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700 ${
                showOverdueBadges ? 'border-l-4 border-red-400 dark:border-red-600' : ''
              }`}
              onClick={() => router.push(`/tickets/${ticket.id}`)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    WO-{ticket.work_order_number}
                  </span>
                  <StatusBadge status={ticket.status} />
                  {showOverdueBadges && <OverdueBadge days={days} />}
                  {ticket.customers?.credit_hold && <CreditHoldBadge />}
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
                {showOverdueBadges
                  ? `Scheduled: ${MONTHS[ticket.month - 1]} ${ticket.year}`
                  : `Scheduled: ${
                      ticket.scheduled_date
                        ? new Date(ticket.scheduled_date).toLocaleDateString()
                        : '—'
                    }`}{' '}
                · Tech: {ticket.users?.name ?? '—'}
                {(ticket.equipment?.ship_to_locations?.city || ticket.customers?.billing_city) && (
                  <> · City: {ticket.equipment?.ship_to_locations?.city ?? ticket.customers?.billing_city}</>
                )}
              </p>
            </div>
          )
        })}
      </div>

      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {isManager && (
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === tickets.length && tickets.length > 0}
                    onChange={onToggleAll}
                    className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">City</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                {showOverdueBadges ? 'Scheduled' : 'Scheduled Date'}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Technician</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {tickets.map((ticket) => {
              const days = showOverdueBadges ? daysOverdue(ticket) : 0
              return (
                <tr
                  key={ticket.id}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                    showOverdueBadges ? 'border-l-4 border-red-400 dark:border-red-600' : ''
                  }`}
                  onClick={() => router.push(`/tickets/${ticket.id}`)}
                >
                  {isManager && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(ticket.id)}
                        onChange={() => onToggleSelect(ticket.id)}
                        className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-medium">
                    WO-{ticket.work_order_number}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={ticket.status} />
                      {showOverdueBadges && <OverdueBadge days={days} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{ticket.customers?.name ?? '—'}</span>
                      {ticket.customers?.credit_hold && <CreditHoldBadge />}
                    </div>
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
                    {showOverdueBadges
                      ? `${MONTHS[ticket.month - 1]} ${ticket.year}`
                      : ticket.scheduled_date
                        ? new Date(ticket.scheduled_date).toLocaleDateString()
                        : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {ticket.users?.name ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function TicketBoard({
  tickets,
  overdueTickets,
  users,
  currentMonth,
  currentYear,
  userRole,
  initialStatus = '',
  overdueMode = false,
}: TicketBoardProps) {
  const isManager = !!userRole && MANAGER_ROLES.includes(userRole)
  const router = useRouter()
  const thisYear = new Date().getFullYear()

  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)
  const [techFilter, setTechFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overdueSelected, setOverdueSelected] = useState<Set<string>>(new Set())
  const [overdueExpanded, setOverdueExpanded] = useState(overdueTickets.length > 0)
  const [assignTo, setAssignTo] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [skipSource, setSkipSource] = useState<'month' | 'overdue'>('month')
  const [error, setError] = useState<string | null>(null)

  const activeSelected = skipSource === 'overdue' ? overdueSelected : selected
  const activeList = skipSource === 'overdue' ? overdueTickets : tickets

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

  function toggleOverdueSelect(id: string) {
    const next = new Set(overdueSelected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOverdueSelected(next)
  }

  function toggleOverdueAll() {
    if (overdueSelected.size === overdueTickets.length) {
      setOverdueSelected(new Set())
    } else {
      setOverdueSelected(new Set(overdueTickets.map((t) => t.id)))
    }
  }

  async function handleBulkAssign(source: 'month' | 'overdue') {
    const ids = source === 'overdue' ? overdueSelected : selected
    if (!assignTo || ids.size === 0) return
    setBulkLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tickets/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: Array.from(ids),
          technicianId: assignTo,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to assign tickets')
        return
      }
      setSelected(new Set())
      setOverdueSelected(new Set())
      setAssignTo('')
      router.refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  function handleSkipSelected(source: 'month' | 'overdue') {
    const ids = source === 'overdue' ? overdueSelected : selected
    if (ids.size === 0) return
    setSkipSource(source)
    setSkipOpen(true)
  }

  function handleSkipDone() {
    setSkipOpen(false)
    setSelected(new Set())
    setOverdueSelected(new Set())
    router.refresh()
  }

  function handleGenerated() {
    setGenerateOpen(false)
    router.push(`/tickets?month=${month}&year=${year}`)
  }

  return (
    <>
      {overdueMode && (
        <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-300 flex items-center justify-between">
          <span>Showing overdue tickets only.</span>
          <button
            onClick={() => router.push('/tickets')}
            className="text-xs font-medium underline hover:no-underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Filters — hidden when viewing overdue-only */}
      {!overdueMode && (
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
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Bulk-assign bar — reflects whichever list has a selection */}
      {isManager && (selected.size > 0 || overdueSelected.size > 0) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className="text-sm text-blue-800 dark:text-blue-300 font-medium">
            {activeSelected.size} {skipSource === 'overdue' ? 'overdue ' : ''}ticket{activeSelected.size > 1 ? 's' : ''} selected
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
              onClick={() => handleBulkAssign(skipSource)}
              disabled={!assignTo || bulkLoading}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {bulkLoading ? 'Assigning...' : 'Assign'}
            </button>
            <button
              onClick={() => handleSkipSelected(skipSource)}
              disabled={bulkLoading}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {bulkLoading ? 'Processing...' : 'Skip Selected'}
            </button>
          </div>
        </div>
      )}

      {/* Pinned Overdue section — always rendered if there are overdue tickets */}
      {overdueTickets.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-red-200 dark:border-red-800 overflow-hidden">
          <button
            onClick={() => setOverdueExpanded((v) => !v)}
            className="w-full bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-center justify-between hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="text-sm font-semibold text-red-800 dark:text-red-300">
                Overdue ({overdueTickets.length})
              </span>
              <span className="text-xs text-red-700/80 dark:text-red-400/80 hidden sm:inline">
                Prior-month tickets not yet completed
              </span>
            </div>
            {overdueExpanded ? (
              <ChevronDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-red-600 dark:text-red-400" />
            )}
          </button>
          {overdueExpanded && (
            <TicketList
              tickets={overdueTickets}
              isManager={isManager}
              selected={overdueSelected}
              onToggleSelect={(id) => {
                setSkipSource('overdue')
                toggleOverdueSelect(id)
              }}
              onToggleAll={() => {
                setSkipSource('overdue')
                toggleOverdueAll()
              }}
              showOverdueBadges
              emptyMessage="No overdue tickets."
            />
          )}
        </div>
      )}

      {/* Month ticket list (hidden in overdue-only mode) */}
      {!overdueMode && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <TicketList
            tickets={tickets}
            isManager={isManager}
            selected={selected}
            onToggleSelect={(id) => {
              setSkipSource('month')
              toggleSelect(id)
            }}
            onToggleAll={() => {
              setSkipSource('month')
              toggleAll()
            }}
            emptyMessage="No tickets found for the selected filters."
          />
        </div>
      )}

      <GeneratePmModal
        open={generateOpen}
        month={month}
        year={year}
        monthLabel={MONTHS[month - 1]}
        onClose={() => setGenerateOpen(false)}
        onGenerated={handleGenerated}
      />

      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {skipOpen && (
        <SkipDialog
          tickets={activeList.filter((t) => activeSelected.has(t.id))}
          onClose={() => setSkipOpen(false)}
          onDone={handleSkipDone}
        />
      )}
    </>
  )
}
