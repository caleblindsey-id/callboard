'use client'

import { Package } from 'lucide-react'
import RowLink from '@/components/ui/RowLink'
import ScrollableTable from '@/components/ScrollableTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import ReorderStatusBadge from '@/components/ReorderStatusBadge'
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

export default function PurchasingList({ sessions }: { sessions: ReorderSessionRow[] }) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Package}
        message={emptyCopy('reorder walks', false)}
      />
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Mobile cards */}
      <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="relative px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
          >
            <RowLink href={sessionHref(session)} label={`Open reorder walk ${session.name}`} />
            <div className="flex items-center justify-between gap-2 mb-1">
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
                <td className="px-3 py-3"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  )
}
