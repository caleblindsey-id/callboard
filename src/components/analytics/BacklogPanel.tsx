'use client'

import Link from 'next/link'
import type { BacklogMetrics, TicketType } from '@/lib/db/analytics'

interface BacklogPanelProps {
  backlog: BacklogMetrics
  ticketType: TicketType
}

const AGING_META: Record<string, { label: string; bar: string; text: string; tile: string }> = {
  '0-7': {
    label: '0–7 days',
    bar: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
    tile: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  },
  '8-30': {
    label: '8–30 days',
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    tile: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  },
  '31+': {
    label: '31+ days',
    bar: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    tile: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  },
}

const PRIORITY_STYLE: Record<string, string> = {
  emergency: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  standard: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
}

function SourceBadge({ source }: { source: 'pm' | 'service' }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        source === 'pm'
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
          : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
      }`}
    >
      {source === 'pm' ? 'PM' : 'Svc'}
    </span>
  )
}

export default function BacklogPanel({ backlog, ticketType }: BacklogPanelProps) {
  const { totalOpen, aging, avgAgeDays, byTechnician, priorityMix, oldestOpen } = backlog

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Open Work</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          As of now · {totalOpen} open
          {avgAgeDays != null ? ` · avg age ${avgAgeDays.toFixed(1)}d` : ''}
        </span>
      </div>

      {totalOpen === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No open {ticketType === 'combined' ? '' : ticketType === 'pm' ? 'PM ' : 'service '}tickets. All caught up.
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Aging buckets */}
          <div>
            <div className="grid grid-cols-3 gap-3">
              {aging.map((b) => {
                const meta = AGING_META[b.bucket]
                return (
                  <div key={b.bucket} className={`rounded-lg border p-3 ${meta.tile}`}>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{b.count}</div>
                    <div className={`text-xs font-medium ${meta.text}`}>{meta.label}</div>
                  </div>
                )
              })}
            </div>
            {/* Proportion bar */}
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              {aging.map((b) => {
                const pct = totalOpen > 0 ? (b.count / totalOpen) * 100 : 0
                if (pct === 0) return null
                return <div key={b.bucket} className={AGING_META[b.bucket].bar} style={{ width: `${pct}%` }} />
              })}
            </div>
          </div>

          {/* Priority mix (service scope only) */}
          {priorityMix && priorityMix.some((p) => p.count > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Priority{ticketType === 'combined' ? ' (service)' : ''}:
              </span>
              {priorityMix.map((p) => (
                <span
                  key={p.priority}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_STYLE[p.priority] ?? PRIORITY_STYLE.standard}`}
                >
                  <span className="capitalize">{p.priority}</span>
                  <span className="font-bold">{p.count}</span>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Open by technician */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Open by technician
              </h3>
              <ul className="space-y-1 max-h-56 overflow-y-auto">
                {byTechnician.map((t) => (
                  <li
                    key={t.id ?? 'unassigned'}
                    className="flex items-center justify-between text-sm py-1 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
                  >
                    <span className={t.id == null ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-900 dark:text-white'}>
                      {t.name}
                    </span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{t.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Oldest open */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Oldest open
              </h3>
              <ul className="space-y-1">
                {oldestOpen.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm py-1 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <SourceBadge source={t.source} />
                      <Link href={`/tickets/${t.id}`} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium shrink-0">
                        WO-{t.workOrderNumber ?? '—'}
                      </Link>
                      <span className="truncate text-gray-600 dark:text-gray-400">{t.customerName ?? '—'}</span>
                    </div>
                    <span className={`shrink-0 font-medium ${t.ageDays > 30 ? 'text-red-600 dark:text-red-400' : t.ageDays > 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      {t.ageDays}d
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
