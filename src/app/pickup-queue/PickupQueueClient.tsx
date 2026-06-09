'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Phone, Mail, MapPin, PackageCheck } from 'lucide-react'
import type { PickupQueueRow } from '@/lib/db/pickup-queue'

type Tab = 'all' | 'call'

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

export default function PickupQueueClient({ rows }: { rows: PickupQueueRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pickedUpName, setPickedUpName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const callCount = useMemo(() => rows.filter((r) => r.contact_status === 'no_contact').length, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'call' && r.contact_status !== 'no_contact') return false
      if (!q) return true
      return (
        r.customer_name.toLowerCase().includes(q) ||
        r.equipment_label.toLowerCase().includes(q) ||
        (r.serial_number ?? '').toLowerCase().includes(q) ||
        String(r.work_order_number ?? '').includes(q)
      )
    })
  }, [rows, tab, query])

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
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Waiting</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
              {filtered.map((r) => {
                const aging = agingBadge(r.days_ready)
                const contact = contactBadge(r)
                return (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3 align-top">
                      <Link href={`/service/${r.id}`} className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                        {r.customer_name}
                      </Link>
                      {r.work_order_number != null && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-gray-900 dark:text-gray-100">{r.equipment_label}</div>
                      {r.serial_number && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">S/N {r.serial_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-600 dark:text-gray-300">
                      {r.shop_location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-gray-400" />
                          {r.shop_location}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
                        {aging.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${contact.classes}`}>
                        {contact.label}
                      </span>
                      {r.contact_status === 'no_contact' && r.resolved_phone && (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 text-gray-400" />
                          {r.resolved_phone}
                        </div>
                      )}
                      {r.resolved_email && r.contact_status !== 'no_contact' && (
                        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {r.resolved_email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
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
                      ) : (
                        <button
                          onClick={() => { setConfirmingId(r.id); setPickedUpName(''); setError(null) }}
                          className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                        >
                          Confirm Pickup
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
