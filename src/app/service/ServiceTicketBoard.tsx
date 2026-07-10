'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import RowLink from '@/components/ui/RowLink'
import { UserRow } from '@/types/database'
import { ServiceTicketWithJoins, ServiceTicketStatus, ServicePriority, ServiceTicketType } from '@/types/service-tickets'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import TicketTypeBadge from '@/components/TicketTypeBadge'
import CreditReviewBadge from '@/components/CreditReviewBadge'
import { displayCreditReviewStatus } from '@/lib/credit-review-status'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import { getStatusMeta } from '@/lib/status-meta'
import { createClient } from '@/lib/supabase/client'
import SortHeader from '@/components/SortHeader'
import ScrollableTable from '@/components/ScrollableTable'
import Tabs, { type TabItem } from '@/components/ui/Tabs'
import FilterBar from '@/components/ui/FilterBar'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'
import { matchesSearch } from '@/lib/search'
import { resolveTicketShipTo, formatShipToLines } from '@/lib/utils/shipTo'
import PushPrompt from '@/components/push/PushPrompt'

type ServiceSortKey =
  | 'work_order_number'
  | 'status'
  | 'priority'
  | 'customer'
  | 'location'
  | 'equipment'
  | 'type'
  | 'technician'
  | 'created'

// Free-text service address captured on the ticket — fallback for the location
// column when no synced ship-to is linked (mirrors the PM board's billing-city
// fallback, but service tickets carry their own address instead).
function serviceAddressLine(ticket: ServiceTicketWithJoins): string | null {
  return (
    [ticket.service_address, ticket.service_city, ticket.service_state]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s)
      .join(', ') || null
  )
}

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
  location: t => {
    const { name } = formatShipToLines(resolveTicketShipTo(t))
    return name ?? t.service_city ?? serviceAddressLine(t)
  },
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
  poNeeded: string
  deleted: string
  search: string
}

// Status tabs for the board — workflow order (actionable stages first, terminal
// states last) so a manager can scan and follow up by stage. `all` is the count
// key for the catch-all tab. Mirrors the ServiceTicketStatus enum.
const STATUS_TABS: { value: '' | ServiceTicketStatus; label: string; countKey: string }[] = [
  { value: '', label: 'All', countKey: 'all' },
  { value: 'open', label: 'Open', countKey: 'open' },
  { value: 'estimated', label: getStatusMeta('service', 'estimated').label, countKey: 'estimated' },
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

// Rows fetched per page. Active-status tabs fit in one page; the big history
// views (All / Completed / Billed) lazy-load via the footer instead of pulling
// every row + joins cross-region on each visit.
const PAGE_SIZE = 100

// Location/ship-to cell, mirroring the PM board's LocationBlock: ship-to name on
// the first line, street/city beneath. Falls back to the free-text service
// address on the ticket when no synced ship-to is linked.
function ServiceLocationBlock({ ticket }: { ticket: ServiceTicketWithJoins }) {
  const { name, street } = formatShipToLines(resolveTicketShipTo(ticket))
  const displayStreet = street ?? serviceAddressLine(ticket)
  if (!name && !displayStreet) {
    return <span className="text-sm text-gray-500 dark:text-gray-400">—</span>
  }
  return (
    <div className="min-w-0">
      {name && (
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name}</div>
      )}
      {displayStreet && (
        <div className={`text-xs text-gray-500 dark:text-gray-400 truncate ${name ? 'mt-0.5' : ''}`}>
          {displayStreet}
        </div>
      )}
    </div>
  )
}

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

function ticketAgeDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
}

interface ServiceTicketBoardProps {
  currentUser: UserRow
  initialFilters: ServiceBoardInitialFilters
}

export function ServiceTicketBoard({ currentUser, initialFilters }: ServiceTicketBoardProps) {
  const isTech = currentUser.role === 'technician'

  // Filters live in the URL so the Back button restores the filtered view.
  const { filters, set, setMany } = useUrlFilters(initialFilters)
  const statusFilter = filters.status as '' | ServiceTicketStatus
  const priorityFilter = filters.priority as '' | ServicePriority
  const typeFilter = filters.type as '' | ServiceTicketType
  const techFilter = filters.tech
  const waitingOnParts = filters.waitingOnParts === '1'
  // Completed tickets for PO-required customers with no customer PO yet. Forces
  // status='completed' server-side; deep-linked from the "Waiting on PO" cards.
  const poNeeded = filters.poNeeded === '1'
  // Manager-only "Deleted" view — shows soft-deleted tickets (restore from detail).
  const deletedView = filters.deleted === '1'

  const [tickets, setTickets] = useState<ServiceTicketWithJoins[]>([])
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ServiceTicketWithJoins,
    ServiceSortKey
  >(tickets, SERVICE_SORT_ACCESSORS)
  // Client-side search over the rows already loaded for the current view. URL-
  // backed (debounced) so Back restores it; deliberately NOT a fetch dependency.
  const search = filters.search ?? ''
  const visible = useMemo(
    () =>
      sorted.filter((t) =>
        matchesSearch(
          [
            t.work_order_number,
            t.customers?.name,
            t.equipment?.make ?? t.equipment_make,
            t.equipment?.model ?? t.equipment_model,
            t.equipment?.serial_number ?? t.equipment_serial_number,
            t.service_address,
            t.service_city,
            t.assigned_technician?.name,
          ],
          search
        )
      ),
    [sorted, search]
  )
  const [users, setUsers] = useState<UserRow[]>([])
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Load-more pagination: true when the last fetch returned a full page, so
  // more rows likely exist beyond what's loaded.
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Bulk assign (managers + office staff). Technicians never see these controls.
  const canManage = !isTech
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

  // Shared by the initial fetch and load-more so the two can never drift on
  // which filters they send.
  const buildListParams = useCallback(() => {
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
    if (poNeeded) params.set('poNeeded', '1')
    params.set('limit', String(PAGE_SIZE))
    return params
  }, [statusFilter, priorityFilter, typeFilter, techFilter, waitingOnParts, poNeeded, deletedView])

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/service-tickets?${buildListParams().toString()}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? 'Failed to load service tickets')
          return
        }
        const data: ServiceTicketWithJoins[] = await res.json()
        setTickets(data)
        setHasMore(data.length === PAGE_SIZE)
      } catch {
        setError('Failed to load service tickets')
      } finally {
        setLoading(false)
      }
    }
    fetchTickets()
  }, [buildListParams, refreshKey])

  async function loadMore() {
    setLoadingMore(true)
    setError(null)
    try {
      const params = buildListParams()
      params.set('offset', String(tickets.length))
      const res = await fetch(`/api/service-tickets?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to load more tickets')
        return
      }
      const data: ServiceTicketWithJoins[] = await res.json()
      // Dedup on append: a ticket created between fetches shifts the offset
      // window, which would otherwise repeat the boundary row.
      setTickets((prev) => {
        const seen = new Set(prev.map((t) => t.id))
        return [...prev, ...data.filter((t) => !seen.has(t.id))]
      })
      setHasMore(data.length === PAGE_SIZE)
    } catch {
      setError('Failed to load more tickets')
    } finally {
      setLoadingMore(false)
    }
  }

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
      prev.size === visible.length ? new Set() : new Set(visible.map((t) => t.id))
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
      {/* Status tabs — primary way to scan/follow up by stage. Pipeline-stage tabs render
          ABOVE FilterBar, not inside it (red-team amendment to standard-draft dimension 6). */}
      <Tabs
        ariaLabel="Filter tickets by status"
        active={deletedView ? 'deleted' : statusFilter || 'all'}
        onChange={(key) => {
          if (key === 'deleted') setMany({ deleted: '1', status: '' })
          else setMany({ deleted: '', status: key === 'all' ? '' : key })
        }}
        tabs={[
          ...STATUS_TABS.map((tab): TabItem => ({
            key: tab.countKey,
            label: tab.label,
            count: counts ? counts[tab.countKey] ?? 0 : undefined,
          })),
          // Manager-only Deleted view. Restore happens from the ticket detail.
          ...(!isTech ? [{ key: 'deleted', label: 'Deleted', count: counts?.deleted }] : []),
        ]}
      />

      {/* Filters */}
      <FilterBar
        search={{
          value: search,
          onChange: (v) => set('search', v, { debounce: true }),
          placeholder: 'WO#, customer, equipment, address, tech',
        }}
        activeCount={[priorityFilter, typeFilter, techFilter].filter(Boolean).length + (waitingOnParts ? 1 : 0) + (poNeeded ? 1 : 0)}
      >
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

        <div className="w-full lg:w-auto flex items-end">
          <label className="flex items-center gap-2 cursor-pointer py-1.5">
            <input
              type="checkbox"
              checked={poNeeded}
              onChange={(e) => set('poNeeded', e.target.checked ? '1' : '')}
              className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">PO Needed</span>
          </label>
        </div>
      </FilterBar>

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
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No tickets match your search.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {visible.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`relative px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700 ${
                    ticket.priority === 'emergency'
                      ? 'border-l-4 border-red-500 bg-red-50/50 dark:bg-red-900/10'
                      : ''
                  }`}
                >
                  <RowLink href={`/service/${ticket.id}`} label={`Open service ticket${ticket.work_order_number ? ` WO-${ticket.work_order_number}` : ''}`} />
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage && !deletedView && (
                        <input
                          type="checkbox"
                          checked={selected.has(ticket.id)}
                          onChange={() => toggleSelect(ticket.id)}
                          className="relative z-10 h-5 w-5 rounded border-gray-300 dark:border-gray-600 accent-slate-600"
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
                  <div className="mt-1">
                    <ServiceLocationBlock ticket={ticket} />
                  </div>
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
                    <TicketTypeBadge type={ticket.ticket_type} />
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
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    {canManage && !deletedView && (
                      <th className="px-4 py-3 text-left w-px">
                        <input
                          type="checkbox"
                          checked={selected.size === visible.length && visible.length > 0}
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
                    <SortHeader label="Location" colKey="location" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Created" colKey="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-3 py-3 w-8" aria-label="Open ticket"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visible.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={`relative hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        ticket.priority === 'emergency'
                          ? 'bg-red-50/50 dark:bg-red-900/10'
                          : ''
                      }`}
                    >
                      {canManage && !deletedView && (
                        <td className="relative z-10 px-4 py-3">
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
                        <RowLink href={`/service/${ticket.id}`} label={`Open service ticket${ticket.work_order_number ? ` WO-${ticket.work_order_number}` : ''}`} />
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
                      <td className="px-4 py-3 max-w-[16rem]">
                        <ServiceLocationBlock ticket={ticket} />
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
                        <TicketTypeBadge type={ticket.ticket_type} />
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
                      <td className="px-3 py-3">
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}

        {/* Load-more footer — only when more rows exist server-side, so small
            boards render exactly as before. Search and sort operate on the
            loaded rows; the count makes the cap visible instead of silent. */}
        {!loading && tickets.length > 0 && hasMore && (
          <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Showing {tickets.length}
              {(() => {
                const total = deletedView
                  ? counts?.deleted
                  : poNeeded
                    ? undefined
                    : counts?.[statusFilter || 'all']
                return total !== undefined ? ` of ${total}` : ''
              })()}{' '}
              tickets
            </span>
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="px-3 py-2.5 lg:py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] lg:min-h-0"
            >
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
