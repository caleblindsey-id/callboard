'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Download, Link2, Check } from 'lucide-react'
import type { PmQuoteWithJoins } from '@/lib/db/pm-quotes'
import type { PmQuoteStatus } from '@/types/database'
import { QUOTE_VALID_TRANSITIONS } from '@/lib/pm-quotes/transitions'
import { formatMoney, formatDate } from '@/lib/format'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'
import ScrollableTable from '@/components/ScrollableTable'

interface PmQuotesClientProps {
  quotes: PmQuoteWithJoins[]
}

const TABS: Array<{ key: 'open' | PmQuoteStatus; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'expired', label: 'Expired' },
  { key: 'void', label: 'Void' },
]

const STATUS_STYLES: Record<PmQuoteStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  declined: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  void: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

export default function PmQuotesClient({ quotes }: PmQuotesClientProps) {
  const router = useRouter()
  const [tab, setTab] = useState<'open' | PmQuoteStatus>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0 }
    for (const q of quotes) {
      c[q.status] = (c[q.status] ?? 0) + 1
      if (q.status === 'draft' || q.status === 'sent') c.open += 1
    }
    return c
  }, [quotes])

  const visible = useMemo(
    () =>
      quotes.filter((q) =>
        tab === 'open' ? q.status === 'draft' || q.status === 'sent' : q.status === tab
      ),
    [quotes, tab]
  )

  async function handleDownload(quote: PmQuoteWithJoins) {
    setBusyId(quote.id)
    setError(null)
    try {
      const res = await fetch(`/api/pm-quotes/${quote.id}/pdf`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Q-${quote.quote_number}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the quote')
    } finally {
      setBusyId(null)
    }
  }

  // Round 1 of delivery is manual: the office copies the link into whatever
  // channel the customer already uses. Sending from CallBoard is a later round,
  // and some accounts have no email address on file at all.
  async function handleCopyLink(quote: PmQuoteWithJoins) {
    if (!quote.approval_token) return
    const url = `${window.location.origin}/q/${quote.approval_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(quote.id)
      setTimeout(() => setCopiedId((id) => (id === quote.id ? null : id)), 2000)
    } catch {
      setError(`Could not copy automatically. The link is ${url}`)
    }
  }

  async function handleStatus(quote: PmQuoteWithJoins, status: PmQuoteStatus) {
    setBusyId(quote.id)
    setError(null)
    try {
      const res = await fetch(`/api/pm-quotes/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the quote')
    } finally {
      setBusyId(null)
    }
  }

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        message="No PM quotes yet. Select work orders on the Preventive Maintenance board and click Quote to build one."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? 'bg-slate-800 text-white dark:bg-slate-600'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600'
            }`}
          >
            {t.label}
            {counts[t.key] ? (
              <span className="ml-1.5 text-xs opacity-75">{counts[t.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {error && <InlineError message={error} />}

      {visible.length === 0 ? (
        <EmptyState icon={FileText} message="No quotes in this state." />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <ScrollableTable>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Quote</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Work Orders</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visible.map((q) => {
                  const nextStates = QUOTE_VALID_TRANSITIONS[q.status]
                  const busy = busyId === q.id
                  return (
                    <tr key={q.id} className="text-gray-900 dark:text-gray-100">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">Q-{q.quote_number}</td>
                      <td className="px-4 py-3">
                        {q.customers?.name ?? '—'}
                        {q.customers?.pm_quote_required && (
                          <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                            quote required
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {q.pm_quote_lines.map((l) => l.work_order_number).filter(Boolean).join(', ') ||
                          '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {formatMoney(q.subtotal)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[q.status]}`}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {formatDate(q.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {q.status === 'sent' && q.approval_token && (
                            <button
                              onClick={() => handleCopyLink(q)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              {copiedId === q.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5" /> Copied
                                </>
                              ) : (
                                <>
                                  <Link2 className="h-3.5 w-3.5" /> Link
                                </>
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDownload(q)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            PDF
                          </button>
                          {nextStates.map((next) => (
                            <button
                              key={next}
                              onClick={() => handleStatus(q, next)}
                              disabled={busy}
                              className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 capitalize"
                            >
                              {next === 'void' ? 'Void' : `Mark ${next}`}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}
    </div>
  )
}
