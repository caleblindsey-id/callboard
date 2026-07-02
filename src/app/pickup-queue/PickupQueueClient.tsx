'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Phone, Mail, MapPin, PackageCheck, Send } from 'lucide-react'
import type { PickupQueueRow } from '@/lib/db/pickup-queue'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

type Tab = 'all' | 'call'

type PickupSortKey = 'customer' | 'equipment' | 'location' | 'waiting' | 'contact'

// Sort Contact by how much follow-up is still owed: no contact info first,
// then has-email, called, emailed.
const CONTACT_RANK: Record<string, number> = {
  has_contact: 1,
  called: 2,
  emailed: 3,
}

const PICKUP_SORT_ACCESSORS: SortAccessors<PickupQueueRow, PickupSortKey> = {
  customer: r => r.customer_name,
  equipment: r => r.equipment_label,
  location: r => r.shop_location,
  waiting: r => r.days_ready,
  contact: r => CONTACT_RANK[r.contact_status] ?? 0,
}

// Units waiting at least this long can be sent a formal abandonment notice.
const ABANDON_DAYS = 30

function agingBadge(days: number | null): { label: string; classes: string } {
  if (days == null) return { label: '—', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 7) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 14) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  if (days <= 30) return { label, classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

function contactBadge(row: PickupQueueRow): { label: string; classes: string } {
  switch (row.contact_status) {
    case 'emailed':
      return { label: `Emailed${row.pickup_notify_count > 1 ? ` ×${row.pickup_notify_count}` : ''}`, classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' }
    case 'called':
      return { label: 'Called', classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' }
    case 'has_contact':
      return { label: 'Has email', classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' }
    default:
      return { label: 'No contact', classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PickupQueueClient({ rows }: { rows: PickupQueueRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  // Pickup-confirm inline form
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pickedUpName, setPickedUpName] = useState('')
  // Call-log inline form
  const [callingId, setCallingId] = useState<string | null>(null)
  const [callNotes, setCallNotes] = useState('')
  // Shop-location inline edit
  const [editingLocId, setEditingLocId] = useState<string | null>(null)
  const [locValue, setLocValue] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Actionable backlog: phone-only units (no email) that haven't been called yet.
  const callCount = useMemo(
    () => rows.filter((r) => r.resolved_email == null && !r.pickup_called_at).length,
    [rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => {
      // Needs Call = phone-only units; called ones stay for follow-up.
      if (tab === 'call' && r.resolved_email != null) return false
      if (!q) return true
      return (
        r.customer_name.toLowerCase().includes(q) ||
        r.equipment_label.toLowerCase().includes(q) ||
        (r.serial_number ?? '').toLowerCase().includes(q) ||
        String(r.work_order_number ?? '').includes(q)
      )
    })
    // In the call tab, surface not-yet-called units first.
    if (tab === 'call') {
      return [...list].sort((a, b) => Number(!!a.pickup_called_at) - Number(!!b.pickup_called_at))
    }
    return list
  }, [rows, tab, query])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    PickupQueueRow,
    PickupSortKey
  >(filtered, PICKUP_SORT_ACCESSORS)

  async function confirmPickup(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picked_up_at: new Date().toISOString(),
          awaiting_pickup: false,
          picked_up_by_name: pickedUpName.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to confirm pickup')
      }
      setConfirmingId(null)
      setPickedUpName('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to confirm pickup')
    } finally {
      setBusyId(null)
    }
  }

  async function markCalled(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/mark-called`, {
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

  async function saveLocation(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_location: locValue.trim() || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to save location')
      }
      setEditingLocId(null)
      setLocValue('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save location')
    } finally {
      setBusyId(null)
    }
  }

  async function sendNotice(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/send-pickup-notice`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to send pickup notice')
      if (body?.sent === false) {
        throw new Error(
          body?.reason === 'no_email'
            ? 'No email on file for this customer.'
            : 'This unit is no longer awaiting pickup.',
        )
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send pickup notice')
    } finally {
      setBusyId(null)
    }
  }

  async function sendAbandonment(id: string) {
    if (!confirm('Send a formal abandonment notice to this customer? This sets a 14-day collection deadline.')) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/abandonment-notice`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to send notice')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send notice')
    } finally {
      setBusyId(null)
    }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All Ready', count: rows.length },
    { key: 'call', label: 'Needs Call', count: callCount },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500 tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
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
          <PackageCheck className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          {tab === 'call' ? 'No units waiting on a phone call.' : 'Nothing waiting for pickup.'}
        </div>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="lg:hidden space-y-3">
          {sorted.map((r) => {
            const aging = agingBadge(r.days_ready)
            const contact = contactBadge(r)
            const noEmail = r.resolved_email == null
            return (
              <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/service/${r.id}`} className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                      {r.customer_name}
                    </Link>
                    {r.work_order_number != null && (
                      <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                    )}
                  </div>
                  <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
                    {aging.label}
                  </span>
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100">
                  {r.equipment_label}
                  {r.serial_number && <span className="text-xs text-gray-400 dark:text-gray-500"> · S/N {r.serial_number}</span>}
                </div>
                {!r.repaired && (
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    Not repaired (declined)
                  </span>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${contact.classes}`}>
                    {contact.label}
                  </span>
                  {editingLocId === r.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={locValue}
                        onChange={(e) => setLocValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLocation(r.id); if (e.key === 'Escape') setEditingLocId(null) }}
                        placeholder="Shelf / bin"
                        className="w-24 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      <button onClick={() => saveLocation(r.id)} disabled={busyId === r.id} className="text-xs font-medium text-blue-600 dark:text-blue-400 disabled:opacity-50">
                        {busyId === r.id ? '…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingLocId(r.id); setLocValue(r.shop_location ?? ''); setError(null) }}
                      className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <MapPin className="h-3.5 w-3.5 text-gray-400" />
                      {r.shop_location || <span className="text-gray-300 dark:text-gray-600">Set location</span>}
                    </button>
                  )}
                </div>
                {noEmail && r.resolved_phone && (
                  <div className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                    <Phone className="h-3 w-3 text-gray-400" />{r.resolved_phone}
                  </div>
                )}
                {r.resolved_email && !noEmail && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />{r.resolved_email}
                  </div>
                )}
                {r.pickup_called_at && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Called {fmtDate(r.pickup_called_at)}{r.pickup_called_by_name ? ` by ${r.pickup_called_by_name}` : ''}
                  </div>
                )}
                {r.abandonment_notice_sent_at && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    Abandonment notice sent {fmtDate(r.abandonment_notice_sent_at)}
                  </div>
                )}

                {confirmingId === r.id ? (
                  <div className="space-y-2 pt-1">
                    <input
                      autoFocus
                      value={pickedUpName}
                      onChange={(e) => setPickedUpName(e.target.value)}
                      placeholder="Picked up by (optional)"
                      className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => confirmPickup(r.id)} disabled={busyId === r.id} className="flex-1 min-h-[44px] px-3 text-sm font-semibold text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50">
                        {busyId === r.id ? 'Saving…' : 'Confirm'}
                      </button>
                      <button onClick={() => { setConfirmingId(null); setPickedUpName('') }} disabled={busyId === r.id} className="flex-1 min-h-[44px] px-3 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : callingId === r.id ? (
                  <div className="space-y-2 pt-1">
                    <input
                      autoFocus
                      value={callNotes}
                      onChange={(e) => setCallNotes(e.target.value)}
                      placeholder="Call notes (optional)"
                      className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => markCalled(r.id)} disabled={busyId === r.id} className="flex-1 min-h-[44px] px-3 text-sm font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50">
                        {busyId === r.id ? 'Saving…' : 'Log call'}
                      </button>
                      <button onClick={() => { setCallingId(null); setCallNotes('') }} disabled={busyId === r.id} className="flex-1 min-h-[44px] px-3 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => { setConfirmingId(r.id); setPickedUpName(''); setCallingId(null); setError(null) }}
                      className="flex-1 min-h-[44px] px-3 text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                    >
                      Confirm Pickup
                    </button>
                    {r.contact_status === 'has_contact' && (
                      <button
                        onClick={() => sendNotice(r.id)}
                        disabled={busyId === r.id}
                        className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1 px-3 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" />
                        {busyId === r.id ? 'Sending…' : 'Send notice'}
                      </button>
                    )}
                    {noEmail && (
                      <button
                        onClick={() => { setCallingId(r.id); setCallNotes(''); setConfirmingId(null); setError(null) }}
                        className="flex-1 min-h-[44px] px-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {r.pickup_called_at ? 'Log follow-up call' : 'Mark Called'}
                      </button>
                    )}
                    {!noEmail && r.days_ready != null && r.days_ready >= ABANDON_DAYS && (
                      <button
                        onClick={() => sendAbandonment(r.id)}
                        disabled={busyId === r.id}
                        className="flex-1 min-h-[44px] px-3 text-sm font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
                      >
                        {busyId === r.id ? 'Sending…' : r.abandonment_notice_sent_at ? 'Resend Abandonment' : 'Abandonment Notice'}
                      </button>
                    )}
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
                <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Location" colKey="location" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Waiting" colKey="waiting" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Contact" colKey="contact" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
              {sorted.map((r) => {
                const aging = agingBadge(r.days_ready)
                const contact = contactBadge(r)
                const noEmail = r.resolved_email == null
                return (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/service/${r.id}`} className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                        {r.customer_name}
                      </Link>
                      {r.work_order_number != null && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-gray-100">{r.equipment_label}</div>
                      {r.serial_number && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">S/N {r.serial_number}</div>
                      )}
                      {!r.repaired && (
                        <span className="mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          Not repaired (declined)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {editingLocId === r.id ? (
                        <div className="inline-flex items-center gap-1">
                          <input
                            autoFocus
                            value={locValue}
                            onChange={(e) => setLocValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveLocation(r.id); if (e.key === 'Escape') setEditingLocId(null) }}
                            placeholder="Shelf / bin"
                            className="w-24 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                          <button
                            onClick={() => saveLocation(r.id)}
                            disabled={busyId === r.id}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 disabled:opacity-50"
                          >
                            {busyId === r.id ? '…' : 'Save'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingLocId(r.id); setLocValue(r.shop_location ?? ''); setError(null) }}
                          className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400"
                          title="Set shop location"
                        >
                          <MapPin className="h-3.5 w-3.5 text-gray-400" />
                          {r.shop_location || <span className="text-gray-300 dark:text-gray-600">Set location</span>}
                        </button>
                      )}
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
                      {noEmail && r.resolved_phone && (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 text-gray-400" />
                          {r.resolved_phone}
                        </div>
                      )}
                      {r.resolved_email && !noEmail && (
                        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {r.resolved_email}
                        </div>
                      )}
                      {r.pickup_called_at && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Called {fmtDate(r.pickup_called_at)}
                          {r.pickup_called_by_name ? ` by ${r.pickup_called_by_name}` : ''}
                          {r.pickup_call_notes ? ` — ${r.pickup_call_notes}` : ''}
                        </div>
                      )}
                      {r.abandonment_notice_sent_at && (
                        <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          Abandonment notice sent {fmtDate(r.abandonment_notice_sent_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {confirmingId === r.id ? (
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <input
                            autoFocus
                            value={pickedUpName}
                            onChange={(e) => setPickedUpName(e.target.value)}
                            placeholder="Picked up by (optional)"
                            className="w-44 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => confirmPickup(r.id)}
                              disabled={busyId === r.id}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {busyId === r.id ? 'Saving…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { setConfirmingId(null); setPickedUpName('') }}
                              disabled={busyId === r.id}
                              className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : callingId === r.id ? (
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
                              onClick={() => markCalled(r.id)}
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
                          <button
                            onClick={() => { setConfirmingId(r.id); setPickedUpName(''); setCallingId(null); setError(null) }}
                            className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                          >
                            Confirm Pickup
                          </button>
                          {r.contact_status === 'has_contact' && (
                            <button
                              onClick={() => sendNotice(r.id)}
                              disabled={busyId === r.id}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50"
                              title="Email the customer that their equipment is ready for pickup"
                            >
                              <Send className="h-3 w-3" />
                              {busyId === r.id ? 'Sending…' : 'Send pickup notice'}
                            </button>
                          )}
                          {noEmail && (
                            <button
                              onClick={() => { setCallingId(r.id); setCallNotes(''); setConfirmingId(null); setError(null) }}
                              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              {r.pickup_called_at ? 'Log follow-up call' : 'Mark Called'}
                            </button>
                          )}
                          {!noEmail && r.days_ready != null && r.days_ready >= ABANDON_DAYS && (
                            <button
                              onClick={() => sendAbandonment(r.id)}
                              disabled={busyId === r.id}
                              className="px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
                            >
                              {busyId === r.id ? 'Sending…' : r.abandonment_notice_sent_at ? 'Resend Abandonment Notice' : 'Send Abandonment Notice'}
                            </button>
                          )}
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
