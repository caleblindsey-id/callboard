'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AceLaborEntry, UserRole } from '@/types/database'

interface Props {
  entry: AceLaborEntry | null
  userRole: UserRole | null
  userId: string | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  paid: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
}

// Read-only summary + tech-editable form for the ACE entry attached to a
// ticket. New entries are created from the completion form (TicketActions /
// ServiceTicketDetail); this card is only shown when an entry already exists.
export default function AceLaborCard({ entry, userRole, userId }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [hours, setHours] = useState(entry ? String(entry.hours) : '')
  const [reason, setReason] = useState(entry?.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!entry) return null

  const isOwner = userRole === 'technician' && entry.tech_id === userId
  const canEdit = isOwner && (entry.status === 'pending' || entry.status === 'rejected')

  async function save() {
    const h = parseFloat(hours)
    if (!Number.isFinite(h) || h <= 0) {
      setError('Hours must be greater than 0.')
      return
    }
    if (!reason.trim()) {
      setError('Reason is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ace-labor/${entry!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: h, reason: reason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save')
      }
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-purple-200 dark:border-purple-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-purple-800 dark:text-purple-300 uppercase tracking-wide">
          ACE Labor
        </h2>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[entry.status] ?? ''}`}>
          {entry.status}
        </span>
      </div>

      {!editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Hours</span>
            <p className="text-gray-900 dark:text-white font-medium">{Number(entry.hours).toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Rate type</span>
            <p className="text-gray-900 dark:text-white font-medium capitalize">{entry.labor_rate_type}</p>
          </div>
          <div className="sm:col-span-2">
            <span className="text-gray-500 dark:text-gray-400">Reason</span>
            <p className="text-gray-900 dark:text-white whitespace-pre-wrap">{entry.reason}</p>
          </div>
          {entry.status === 'rejected' && entry.rejected_reason && (
            <div className="sm:col-span-2">
              <span className="text-red-700 dark:text-red-400 font-medium">Rejected:</span>
              <p className="text-red-800 dark:text-red-300 whitespace-pre-wrap">{entry.rejected_reason}</p>
            </div>
          )}
          {entry.status === 'approved' && entry.rate_value_at_approval != null && (
            <div className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
              Approved at ${Number(entry.rate_value_at_approval).toFixed(2)}/hr — billable value ${(Number(entry.hours) * Number(entry.rate_value_at_approval)).toFixed(2)}
            </div>
          )}
          {entry.status === 'paid' && entry.payout_period && (
            <div className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
              Paid in {entry.payout_period}
            </div>
          )}
          {canEdit && (
            <div className="sm:col-span-2 pt-2">
              <button
                type="button"
                onClick={() => { setEditing(true); setError(null) }}
                className="px-3 py-1 text-xs font-medium rounded-md border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              >
                {entry.status === 'rejected' ? 'Edit & Resubmit' : 'Edit'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hours</label>
            <input
              type="number"
              step="0.25"
              min="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="px-3 py-1 text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : (entry.status === 'rejected' ? 'Resubmit' : 'Save')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false)
                setHours(String(entry!.hours))
                setReason(entry!.reason)
                setError(null)
              }}
              className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
