'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { AceLaborEntryWithJoins } from '@/lib/db/ace-labor'

interface Props {
  entries: AceLaborEntryWithJoins[]
  currentUserId: string
}

type Tab = 'pending' | 'history'

function formatDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString()
}

function ticketLink(e: AceLaborEntryWithJoins): { href: string; label: string; customer: string } {
  if (e.pm_ticket) {
    return {
      href: `/tickets/${e.pm_ticket.id}`,
      label: `PM ${e.pm_ticket.work_order_number ?? e.pm_ticket.id.slice(0, 8)}`,
      customer: e.pm_ticket.customers?.name ?? '—',
    }
  }
  if (e.service_ticket) {
    return {
      href: `/service/${e.service_ticket.id}`,
      label: `Service ${e.service_ticket.work_order_number ?? e.service_ticket.id.slice(0, 8)}`,
      customer: e.service_ticket.customers?.name ?? '—',
    }
  }
  return { href: '#', label: '—', customer: '—' }
}

export default function AceLaborClient({ entries, currentUserId }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const pending = useMemo(() => entries.filter(e => e.status === 'pending'), [entries])
  const history = useMemo(
    () => entries.filter(e => e.status === 'approved' || e.status === 'rejected' || e.status === 'paid'),
    [entries],
  )

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/ace-labor/${id}/approve`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to approve')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setError('A reason is required to reject.')
      return
    }
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/ace-labor/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reject')
      }
      setRejectingId(null)
      setRejectReason('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => { setTab('pending'); setError(null) }}
          className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 ${
            tab === 'pending'
              ? 'border-purple-600 text-purple-700 dark:text-purple-300'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          Pending ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => { setTab('history'); setError(null) }}
          className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 ${
            tab === 'history'
              ? 'border-purple-600 text-purple-700 dark:text-purple-300'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          History
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {tab === 'pending' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Tech</th>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">Hours</th>
                <th className="px-3 py-2">Rate type</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {pending.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                    No pending ACE labor entries.
                  </td>
                </tr>
              )}
              {pending.map(e => {
                const link = ticketLink(e)
                const isSelf = e.tech_id === currentUserId
                return (
                  <tr key={e.id} className="bg-white dark:bg-gray-900">
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{e.tech?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Link href={link.href} className="text-blue-600 dark:text-blue-400 hover:underline">{link.label}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{link.customer}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{formatDate(e.submitted_at)}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{Number(e.hours).toFixed(2)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 capitalize">{e.labor_rate_type}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-md whitespace-pre-wrap">{e.reason}</td>
                    <td className="px-3 py-2 text-right">
                      {isSelf ? (
                        <span className="text-xs italic text-gray-500 dark:text-gray-400">Own entry</span>
                      ) : rejectingId === e.id ? (
                        <div className="flex flex-col gap-2 items-end">
                          <textarea
                            value={rejectReason}
                            onChange={(ev) => setRejectReason(ev.target.value)}
                            rows={2}
                            placeholder="Rejection reason..."
                            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-2 py-1 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => { setRejectingId(null); setRejectReason(''); setError(null) }}
                              className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={busyId === e.id}
                              onClick={() => reject(e.id)}
                              className="px-2 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Confirm reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            onClick={() => approve(e.id)}
                            className="px-3 py-1 text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            onClick={() => { setRejectingId(e.id); setRejectReason(''); setError(null) }}
                            className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'history' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Tech</th>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Hours</th>
                <th className="px-3 py-2">Rate type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Decided</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {history.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                    No decided entries yet.
                  </td>
                </tr>
              )}
              {history.map(e => {
                const link = ticketLink(e)
                const badge =
                  e.status === 'approved'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : e.status === 'paid'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                return (
                  <tr key={e.id} className="bg-white dark:bg-gray-900">
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{e.tech?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Link href={link.href} className="text-blue-600 dark:text-blue-400 hover:underline">{link.label}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{Number(e.hours).toFixed(2)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 capitalize">{e.labor_rate_type}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{formatDate(e.approved_at)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.approver?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-md whitespace-pre-wrap">
                      {e.status === 'rejected' ? (e.rejected_reason ?? '—') : e.reason}
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
