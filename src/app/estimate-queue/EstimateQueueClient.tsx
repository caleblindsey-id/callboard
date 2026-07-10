'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Phone, Mail, FileText, ChevronRight } from 'lucide-react'
import type { EstimateQueueRow } from '@/lib/db/estimate-queue'
import TicketTypeBadge from '@/components/TicketTypeBadge'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import Tabs, { type TabItem } from '@/components/ui/Tabs'

type Tab = 'all' | 'needs_contact'

type EstimateSortKey = 'customer' | 'type' | 'equipment' | 'amount' | 'age' | 'contact'

// Sort Contact by how much follow-up is still owed: needs-contact first, then
// called, then emailed.
const CONTACT_RANK: Record<string, number> = {
  needs_first_contact: 1,
  called: 2,
  emailed: 3,
}

const ESTIMATE_SORT_ACCESSORS: SortAccessors<EstimateQueueRow, EstimateSortKey> = {
  customer: r => r.customer_name,
  type: r => r.ticket_type,
  equipment: r => r.equipment_label,
  amount: r => r.estimate_amount,
  age: r => r.days_since_estimate,
  contact: r => CONTACT_RANK[r.contact_status] ?? 0,
}

// Estimate follow-up is more time-sensitive than pickup — a decision sitting a
// week is already stale. Tighter thresholds than the pickup queue.
function agingBadge(days: number | null): { label: string; classes: string } {
  if (days == null) return { label: '—', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 2) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 6) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  if (days <= 13) return { label, classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

function contactBadge(row: EstimateQueueRow): { label: string; classes: string } {
  switch (row.contact_status) {
    case 'emailed':
      return { label: `Emailed${row.estimate_notify_count > 1 ? ` ×${row.estimate_notify_count}` : ''}`, classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' }
    case 'called':
      return { label: 'Called', classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' }
    default:
      return { label: 'Needs first contact', classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtMoney(amount: number | null): string {
  if (amount == null) return '—'
  return `$${amount.toFixed(2)}`
}

export default function EstimateQueueClient({ rows }: { rows: EstimateQueueRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  // Call-log inline form
  const [callingId, setCallingId] = useState<string | null>(null)
  const [callNotes, setCallNotes] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Actionable backlog: estimates with no first contact yet.
  const needsContactCount = useMemo(
    () => rows.filter((r) => r.contact_status === 'needs_first_contact').length,
    [rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'needs_contact' && r.contact_status !== 'needs_first_contact') return false
      if (!q) return true
      return (
        r.customer_name.toLowerCase().includes(q) ||
        r.equipment_label.toLowerCase().includes(q) ||
        (r.serial_number ?? '').toLowerCase().includes(q) ||
        String(r.work_order_number ?? '').includes(q)
      )
    })
  }, [rows, tab, query])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    EstimateQueueRow,
    EstimateSortKey
  >(filtered, ESTIMATE_SORT_ACCESSORS)

  async function emailEstimate(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/send-estimate`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to send estimate email')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send estimate email')
    } finally {
      setBusyId(null)
    }
  }

  async function markContacted(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/mark-estimate-contacted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: callNotes.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to log the call')
      }
      setCallingId(null)
      setCallNotes('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log the call')
    } finally {
      setBusyId(null)
    }
  }

  const tabs: TabItem[] = [
    { key: 'all', label: 'All Estimates', count: rows.length },
    { key: 'needs_contact', label: 'Needs First Contact', count: needsContactCount },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Tabs
          ariaLabel="Filter estimates"
          tabs={tabs}
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          className="w-fit"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer, equipment, serial, WO#"
          className="w-full sm:w-72 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <FileText className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          {tab === 'needs_contact' ? 'Every estimate has had first contact.' : 'No estimates awaiting a decision.'}
        </div>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="lg:hidden space-y-3">
          {sorted.map((r) => {
            const aging = agingBadge(r.days_since_estimate)
            const contact = contactBadge(r)
            const hasEmail = r.resolved_email != null
            return (
              <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/service/${r.id}`} className="inline-flex items-center gap-1 rounded font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
                      {r.customer_name}
                      <ChevronRight className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                    </Link>
                    {r.work_order_number != null && (
                      <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                    )}
                  </div>
                  <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
                    {aging.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <TicketTypeBadge type={r.ticket_type} />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{r.equipment_label}</span>
                </div>
                {r.serial_number && (
                  <div className="text-xs text-gray-400 dark:text-gray-500">S/N {r.serial_number}</div>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(r.estimate_amount)}</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${contact.classes}`}>
                    {contact.label}
                  </span>
                </div>
                {hasEmail ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />{r.resolved_email}
                  </div>
                ) : r.resolved_phone ? (
                  <div className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                    <Phone className="h-3 w-3 text-gray-400" />{r.resolved_phone}
                  </div>
                ) : (
                  <div className="text-xs text-red-500 dark:text-red-400">No email or phone on file</div>
                )}
                {callingId === r.id ? (
                  <div className="space-y-2 pt-1">
                    <input
                      autoFocus
                      value={callNotes}
                      onChange={(e) => setCallNotes(e.target.value)}
                      placeholder="Call notes (optional)"
                      className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => markContacted(r.id)}
                        disabled={busyId === r.id}
                        className="flex-1 min-h-[44px] px-3 text-sm font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyId === r.id ? 'Saving…' : 'Log call'}
                      </button>
                      <button
                        onClick={() => { setCallingId(null); setCallNotes('') }}
                        disabled={busyId === r.id}
                        className="flex-1 min-h-[44px] px-3 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-1">
                    {hasEmail && (
                      <button
                        onClick={() => emailEstimate(r.id)}
                        disabled={busyId === r.id}
                        className="flex-1 min-h-[44px] px-3 text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                      >
                        {busyId === r.id ? 'Sending…' : r.estimate_emailed_at ? 'Resend Estimate' : 'Email Estimate'}
                      </button>
                    )}
                    <button
                      onClick={() => { setCallingId(r.id); setCallNotes(''); setError(null) }}
                      className="flex-1 min-h-[44px] px-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {r.estimate_called_at ? 'Log follow-up call' : 'Log call'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Desktop table */}
        <ScrollableTable className="hidden lg:block rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Estimate" colKey="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Age" colKey="age" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Contact" colKey="contact" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
              {sorted.map((r) => {
                const aging = agingBadge(r.days_since_estimate)
                const contact = contactBadge(r)
                const hasEmail = r.resolved_email != null
                return (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/service/${r.id}`} className="inline-flex items-center gap-1 rounded font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
                        {r.customer_name}
                        <ChevronRight className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                      </Link>
                      {r.work_order_number != null && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TicketTypeBadge type={r.ticket_type} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-gray-100">{r.equipment_label}</div>
                      {r.serial_number && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">S/N {r.serial_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 tabular-nums">
                      {fmtMoney(r.estimate_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
                        {aging.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${contact.classes}`}>
                        {contact.label}
                      </span>
                      {hasEmail ? (
                        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {r.resolved_email}
                        </div>
                      ) : r.resolved_phone ? (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 text-gray-400" />
                          {r.resolved_phone}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-red-500 dark:text-red-400">No email or phone on file</div>
                      )}
                      {r.estimate_last_emailed_at && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Last emailed {fmtDate(r.estimate_last_emailed_at)}
                        </div>
                      )}
                      {r.estimate_called_at && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Called {fmtDate(r.estimate_called_at)}
                          {r.estimate_called_by_name ? ` by ${r.estimate_called_by_name}` : ''}
                          {r.estimate_contact_notes ? ` — ${r.estimate_contact_notes}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {callingId === r.id ? (
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <input
                            autoFocus
                            value={callNotes}
                            onChange={(e) => setCallNotes(e.target.value)}
                            placeholder="Call notes (optional)"
                            className="w-52 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => markContacted(r.id)}
                              disabled={busyId === r.id}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {busyId === r.id ? 'Saving…' : 'Log call'}
                            </button>
                            <button
                              onClick={() => { setCallingId(null); setCallNotes('') }}
                              disabled={busyId === r.id}
                              className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-end gap-1.5">
                          {hasEmail && (
                            <button
                              onClick={() => emailEstimate(r.id)}
                              disabled={busyId === r.id}
                              className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                            >
                              {busyId === r.id ? 'Sending…' : r.estimate_emailed_at ? 'Resend Estimate' : 'Email Estimate'}
                            </button>
                          )}
                          <button
                            onClick={() => { setCallingId(r.id); setCallNotes(''); setError(null) }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            {r.estimate_called_at ? 'Log follow-up call' : 'Log call'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollableTable>
        </>
      )}
    </div>
  )
}
