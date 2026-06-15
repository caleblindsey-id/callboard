'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { UserRow } from '@/types/database'
import { ServiceTicketWithJoins, ServiceTicketStatus, ServicePriority, ServiceTicketType } from '@/types/service-tickets'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import CreditReviewBadge from '@/components/CreditReviewBadge'
import { displayCreditReviewStatus } from '@/lib/credit-review-status'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import { createClient } from '@/lib/supabase/client'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'
import PushPrompt from '@/components/push/PushPrompt'

type ServiceSortKey =
  | 'work_order_number'
  | 'status'
  | 'priority'
  | 'customer'
  | 'equipment'
  | 'type'
  | 'technician'
  | 'created'

// Sort priority by severity (emergency first), not alphabetically.
const PRIORITY_RANK: Record<ServicePriority, number> = {
  emergency: 0,
  standard: 1,
  low: 2,
}

const SERVICE_SORT_ACCESSORS: SortAccessors<ServiceTicketWithJoins, ServiceSortKey> = {
  work_order_number: t => t.work_order_number,
  status: t => t.status,
  priority: t => PRIORITY_RANK[t.priority] ?? 99,
  customer: t => t.customers?.name,
  equipment: t =>
    [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') ||
    [t.equipment_make, t.equipment_model].filter(Boolean).join(' ') ||
    null,
  type: t => t.ticket_type,
  technician: t => t.assigned_technician?.name,
  created: t => t.created_at,
}

// `type` (not `interface`) so it satisfies the hook's `Record<string, string>`
// constraint — interfaces have no implicit index signature.
export type ServiceBoardInitialFilters = {
  status: string
  priority: string
  type: string
  tech: string
  waitingOnParts: string
  deleted: string
}

// Status tabs for the board — workflow order (actionable stages first, terminal
// states last) so a manager can scan and follow up by stage. `all` is the count
// key for the catch-all tab. Mirrors the ServiceTicketStatus enum.
const STATUS_TABS: { value: '' | ServiceTicketStatus; label: string; countKey: string }[] = [
  { value: '', label: 'All', countKey: 'all' },
  { value: 'open', label: 'Open', countKey: 'open' },
  { value: 'estimated', label: 'Estimated', countKey: 'estimated' },
  { value: 'approved', label: 'Approved', countKey: 'approved' },
  { value: 'in_progress', label: 'In Progress', countKey: 'in_progress' },
  { value: 'completed', label: 'Completed', countKey: 'completed' },
  { value: 'billed', label: 'Billed', countKey: 'billed' },
  { value: 'declined', label: 'Declined', countKey: 'declined' },
  { value: 'canceled', label: 'Canceled', countKey: 'canceled' },
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
  initialFilters: ServiceBoardInitialFilters
}

export function ServiceTicketBoard({ currentUser, initialFilters }: ServiceTicketBoardProps) {
  const isTech = currentUser.role === 'technician'
  const router = useRouter()

  // Filters live in the URL so the Back button restores the filtered view.
  const { filters, set, setMany } = useUrlFilters(initialFilters)
  const statusFilter = filters.status as '' | ServiceTicketStatus
  const priorityFilter = filters.priority as '' | ServicePriority
  const typeFilter = filters.type as '' | ServiceTicketType
  const techFilter = filters.tech
  const waitingOnParts = filters.waitingOnParts === '1'
  // Manager-only "Deleted" view — shows soft-deleted tickets (restore from detail).
  const deletedView = filters.deleted === '1'

  const [tickets, setTickets] = useState<ServiceTicketWithJoins[]>([])
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ServiceTicketWithJoins,
    ServiceSortKey
  >(tickets, SERVICE_SORT_ACCESSORS)
  const [users, setUsers] = useState<UserRow[]>([])
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Bulk assign (managers + office staff). Technicians never see these controls.
  const canManage = !isTech
  // Techs can create a service ticket only when granted the per-tech permission.
  const canCreateTickets = !isTech || currentUser.can_create_service_tickets
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  // Bumped to force a ticket re-fetch after a mutation (bulk assign).
  const [refreshKey, setRefreshKey] = useState(0)

  // Load active technicians for the bulk-assign dropdown AND the technician
  // filter. NB: the old `/api/users` GET fetch silently failed (no GET handler
  // exists), leaving the filter empty — this client-side query is the proven
  // pattern used by the create form.
  useEffect(() => {
    if (isTech) return
    createClient()
      .from('users')
      .select('*')
      .eq('active', true)
      .eq('role', 'technician')
      .order('name')
      .then(({ data }) => {
        if (data) setUsers(data)
      })
  }, [isTech])

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (deletedView) {
          params.set('deleted', '1')
        } else if (statusFilter) {
          params.set('status', statusFilter)
        }
        if (priorityFilter) params.set('priority', priorityFilter)
        if (typeFilter) params.set('ticketType', typeFilter)
        if (techFilter) params.set('technicianId', techFilter)
        if (waitingOnParts) params.set('waitingOnParts', 'true')

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
  }, [statusFilter, priorityFilter, typeFilter, techFilter, waitingOnParts, deletedView, refreshKey])

  // Prune any selected ids that are no longer in the current list (filter change
  // or refresh) so a stale selection can't be bulk-assigned.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tickets.map((t) => t.id))
      const next = new Set<string>()
      prev.forEach((id) => { if (ids.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [tickets])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === tickets.length ? new Set() : new Set(tickets.map((t) => t.id))
    )
  }

  async function handleBulkAssign() {
    if (!assignTo || selected.size === 0) return
    setBulkLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/service-tickets/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: Array.from(selected), technicianId: assignTo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to assign tickets')
        return
      }
      setSelected(new Set())
      setAssignTo('')
      setRefreshKey((k) => k + 1)
    } finally {
      setBulkLoading(false)
    }
  }

  // Tab counts are intentionally NOT keyed on statusFilter — switching tabs
  // shouldn't reload the numbers, only the other filters narrow them.
  useEffect(() => {
    async function fetchCounts() {
      try {
        const params = new URLSearchParams()
        if (priorityFilter) params.set('priority', priorityFilter)
        if (typeFilter) params.set('ticketType', typeFilter)
        if (techFilter) params.set('technicianId', techFilter)
        if (waitingOnParts) params.set('waitingOnParts', 'true')

        const res = await fetch(`/api/service-tickets/counts?${params.toString()}`)
        if (res.ok) {
          setCounts(await res.json())
        }
      } catch {
        // non-critical — tabs just render without counts
      }
    }
    fetchCounts()
  }, [priorityFilter, typeFilter, techFilter, waitingOnParts])

  return (
    <div className="space-y-6">
      {/* Techs are the assignment-notification targets — nudge them to enable push. */}
      {isTech && <PushPrompt />}
      {/* Status tabs — primary way to scan/follow up by stage. Horizontal-scrolls on mobile. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter tickets by status">
          {STATUS_TABS.map((tab) => {
            const active = !deletedView && statusFilter === tab.value
            const count = counts ? counts[tab.countKey] ?? 0 : undefined
            return (
              <button
                key={tab.countKey}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMany({ deleted: '', status: tab.value })}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] lg:min-h-0 ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {tab.label}
                {count !== undefined && (
                  <span
                    className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] text-xs font-semibold ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {/* Manager-only Deleted view. Restore happens from the ticket detail. */}
          {!isTech && (
            <button
              type="button"
              role="tab"
              aria-selected={deletedView}
              onClick={() => setMany({ deleted: '1', status: '' })}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] lg:min-h-0 ${
                deletedView
                  ? 'bg-slate-800 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Deleted
              {counts?.deleted !== undefined && (
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] text-xs font-semibold ${
                    deletedView
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {counts.deleted}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => set('priority', e.target.value)}
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
              onChange={(e) => set('type', e.target.value)}
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
                onChange={(e) => set('tech', e.target.value)}
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
                onChange={(e) => set('waitingOnParts', e.target.checked ? '1' : '')}
                className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Waiting on Parts</span>
            </label>
          </div>

          {canCreateTickets && (
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

      {/* Bulk assign toolbar — appears once tickets are selected. Managers +
          office staff only; hidden in the Deleted view. */}
      {canManage && !deletedView && selected.size > 0 && (
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
              onClick={() => setSelected(new Set())}
              disabled={bulkLoading}
              className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              Clear
            </button>
          </div>
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
              {sorted.map((ticket) => (
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
                      {canManage && !deletedView && (
                        <input
                          type="checkbox"
                          checked={selected.has(ticket.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(ticket.id)}
                          className="h-5 w-5 rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                          aria-label="Select ticket"
                        />
                      )}
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
                    {(() => {
                      const cr = displayCreditReviewStatus(ticket.credit_reviews)
                      return cr ? <CreditReviewBadge status={cr} /> : null
                    })()}
                  </div>
                  {ticket.customers?.account_number && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Acct #{ticket.customers.account_number}
                    </p>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[ticket.equipment?.make, ticket.equipment?.model].filter(Boolean).join(' ') ||
                      [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') ||
                      '—'}
                  </p>
                  {(ticket.equipment?.serial_number || ticket.equipment_serial_number) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      SN: {ticket.equipment?.serial_number || ticket.equipment_serial_number}
                    </p>
                  )}
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
                    {canManage && !deletedView && (
                      <th className="px-4 py-3 text-left w-px">
                        <input
                          type="checkbox"
                          checked={selected.size === tickets.length && tickets.length > 0}
                          onChange={toggleAll}
                          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                          aria-label="Select all tickets"
                        />
                      </th>
                    )}
                    <SortHeader label="WO #" colKey="work_order_number" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Priority" colKey="priority" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Created" colKey="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                        ticket.priority === 'emergency'
                          ? 'bg-red-50/50 dark:bg-red-900/10'
                          : ''
                      }`}
                      onClick={() => router.push(`/service/${ticket.id}`)}
                    >
                      {canManage && !deletedView && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(ticket.id)}
                            onChange={() => toggleSelect(ticket.id)}
                            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                            aria-label="Select ticket"
                          />
                        </td>
                      )}
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
                    {(() => {
                      const cr = displayCreditReviewStatus(ticket.credit_reviews)
                      return cr ? <CreditReviewBadge status={cr} /> : null
                    })()}
                        </div>
                        {ticket.customers?.account_number && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Acct #{ticket.customers.account_number}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        <div>
                          {[ticket.equipment?.make, ticket.equipment?.model].filter(Boolean).join(' ') ||
                            [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') ||
                            '—'}
                        </div>
                        {(ticket.equipment?.serial_number || ticket.equipment_serial_number) && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            SN: {ticket.equipment?.serial_number || ticket.equipment_serial_number}
                          </div>
                        )}
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
