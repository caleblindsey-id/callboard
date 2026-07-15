'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Trash2 } from 'lucide-react'
import RowLink from '@/components/ui/RowLink'
import ScrollableTable from '@/components/ScrollableTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import ReorderStatusBadge from '@/components/ReorderStatusBadge'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatMoney, formatDate } from '@/lib/format'
import type { ReorderSessionRow } from '@/types/reorder'

// A session already through review lands the reader on the vendor-grouped
// review screen (P4) instead of re-opening the item-by-item walk.
function sessionHref(session: ReorderSessionRow): string {
  return session.status === 'review' || session.status === 'ordered'
    ? `/purchasing/${session.id}/review`
    : `/purchasing/${session.id}`
}

function scopeLabel(session: ReorderSessionRow): string {
  switch (session.scope_type) {
    case 'all':
      return 'All items'
    case 'below_rop':
      return 'Below reorder point'
    case 'zone':
      return `Zone ${session.scope_value ?? ''}`.trim()
    case 'vendor':
      return `Vendor ${session.scope_value ?? ''}`.trim()
    default:
      return session.scope_type
  }
}

function ProgressBar({ session }: { session: ReorderSessionRow }) {
  const pct = session.total_items > 0
    ? Math.min(100, Math.round((session.lines_ordered / session.total_items) * 100))
    : 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden shrink-0">
        <div className="h-full bg-slate-600 dark:bg-slate-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {session.lines_ordered} / {session.total_items}
      </span>
    </div>
  )
}

// Sessions past review carry Synergy PO numbers and order history that only
// live on this row — call that out explicitly so a delete isn't mistaken for
// a lightweight undo of an abandoned walk.
function deleteConfirmMessage(session: ReorderSessionRow): string {
  const base = `"${session.name}" and its entered quantities will be permanently deleted. This cannot be undone.`
  if (session.status === 'ordered' || session.status === 'closed') {
    return `${base}\n\nThis walk has recorded PO numbers and order history. Deleting it will lose that record too.`
  }
  return base
}

export default function PurchasingList({
  sessions,
  canDelete = false,
}: {
  sessions: ReorderSessionRow[]
  canDelete?: boolean
}) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<ReorderSessionRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function openDelete(e: React.MouseEvent, session: ReorderSessionRow) {
    e.preventDefault()
    e.stopPropagation()
    setDeleteError(null)
    setDeleteTarget(session)
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/purchasing/sessions/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDeleteError(body.error || 'Failed to delete the reorder walk.')
        return
      }
      setDeleteTarget(null)
      router.refresh()
    } catch {
      setDeleteError('Failed to delete the reorder walk.')
    } finally {
      setDeleting(false)
    }
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Package}
        message={emptyCopy('reorder walks', false)}
      />
    )
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <div className="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          {deleteError}
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Mobile cards */}
        <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="relative px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
            >
              <RowLink href={sessionHref(session)} label={`Open reorder walk ${session.name}`} />
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => openDelete(e, session)}
                  aria-label={`Delete walk ${session.name}`}
                  className="absolute z-10 top-3 right-4 p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-md"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <div className="flex items-center justify-between gap-2 mb-1 pr-8">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {session.name}
                </p>
                <ReorderStatusBadge status={session.status} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {scopeLabel(session)} · {formatDate(session.created_at)}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <ProgressBar session={session} />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatMoney(session.est_total_cost)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <ScrollableTable className="hidden lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Scope</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Created</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Progress</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Est. Total</th>
                <th className="px-3 py-3 w-8" aria-label="Open walk"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {sessions.map((session) => (
                <tr key={session.id} className="relative hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">
                    {session.name}
                    <RowLink href={sessionHref(session)} label={`Open reorder walk ${session.name}`} />
                  </td>
                  <td className="px-4 py-3">
                    <ReorderStatusBadge status={session.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{scopeLabel(session)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDate(session.created_at)}</td>
                  <td className="px-4 py-3">
                    <ProgressBar session={session} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                    {formatMoney(session.est_total_cost)}
                  </td>
                  <td className="relative z-10 px-3 py-3">
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => openDelete(e, session)}
                        aria-label={`Delete walk ${session.name}`}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-md"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete reorder walk"
        message={deleteTarget ? deleteConfirmMessage(deleteTarget) : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
