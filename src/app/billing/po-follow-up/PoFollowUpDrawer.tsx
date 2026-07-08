'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Phone, Mail, MessageSquare, MoreHorizontal } from 'lucide-react'
import { formatDateTimeLong } from '@/lib/format'
import type { PoFollowUpMethod } from '@/types/database'

interface FollowUpEntry {
  id: string
  method: PoFollowUpMethod
  note: string | null
  contacted_at: string
  contacted_by_user: { name: string } | null
}

const METHODS: { value: PoFollowUpMethod; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Text' },
  { value: 'other', label: 'Other' },
]

function MethodIcon({ method }: { method: PoFollowUpMethod }) {
  const cls = 'h-3.5 w-3.5'
  if (method === 'call') return <Phone className={cls} />
  if (method === 'email') return <Mail className={cls} />
  if (method === 'text') return <MessageSquare className={cls} />
  return <MoreHorizontal className={cls} />
}

function methodLabel(method: PoFollowUpMethod): string {
  return METHODS.find((m) => m.value === method)?.label ?? method
}

interface PoFollowUpDrawerProps {
  ticketId: string | null
  title: string | null
  subtitle: string | null
  onClose: () => void
  // Called after a contact is logged so the parent can refresh the row recency.
  onLogged: () => void
}

// Slide-over PO-collection log for one service ticket: the append-only history of
// outreach attempts (who, method, when, note) plus the Log-Contact form. Mirrors
// the customer BillingNotesDrawer, but per-ticket and structured (method).
export default function PoFollowUpDrawer({
  ticketId,
  title,
  subtitle,
  onClose,
  onLogged,
}: PoFollowUpDrawerProps) {
  const open = ticketId != null
  const [entries, setEntries] = useState<FollowUpEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [method, setMethod] = useState<PoFollowUpMethod>('call')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    if (!ticketId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}/po-follow-ups`)
      if (!res.ok) throw new Error('Failed to load follow-ups')
      setEntries(await res.json())
      setError(null)
    } catch {
      setError('Failed to load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => {
    if (!open) return
    setMethod('call')
    setNote('')
    fetchEntries()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, ticketId, fetchEntries, onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ticketId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}/po-follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, note: note.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to log contact')
      }
      setNote('')
      setMethod('call')
      await fetchEntries()
      onLogged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log contact')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 shadow-xl flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
              PO Follow-Up
            </h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 truncate">{title ?? '—'}</p>
            {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Log contact form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Method</label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    method === m.value
                      ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                  }`}
                >
                  <MethodIcon method={m.value} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. left VM for AP, customer says PO Friday, emailed buyer)…"
            maxLength={2000}
            rows={2}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-gray-500">{note.length}/2000</span>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {submitting ? 'Logging…' : 'Log Contact'}
            </button>
          </div>
        </form>

        {error && (
          <div className="px-5 py-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30">{error}</div>
        )}

        {/* History */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No contact logged yet. Log the first outreach above.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map((entry) => (
                <div key={entry.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      <MethodIcon method={entry.method} />
                      {methodLabel(entry.method)}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {entry.contacted_by_user?.name ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDateTimeLong(entry.contacted_at)}
                    </span>
                  </div>
                  {entry.note && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{entry.note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
