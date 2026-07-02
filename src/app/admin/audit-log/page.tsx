import Link from 'next/link'
import { requireRole, AUDIT_ROLES } from '@/lib/auth'
import { listAuditEvents, listAuditActors, findTicketsByWorkOrder } from '@/lib/db/auditEvents'
import {
  ENTITY_LABELS,
  ENTITY_TYPES,
  ACTION_LABELS,
  type AuditAction,
  type AuditActorType,
  entityLabel,
  actorDisplayName,
  changeSummary,
  formatOccurredAt,
} from '@/lib/audit/format'
import ScrollableTable from '@/components/ScrollableTable'

const PAGE_SIZE = 50

type SearchParams = {
  entity?: string
  user?: string
  action?: string
  actor_type?: string
  start?: string
  end?: string
  wo?: string
  page?: string
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function buildQs(params: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...params, ...overrides })) {
    if (v && typeof v === 'string') merged[k] = v
  }
  const qs = new URLSearchParams(merged).toString()
  return qs ? `?${qs}` : ''
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireRole(...AUDIT_ROLES)
  const params = await searchParams
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE

  const entityType = params.entity || undefined
  const changedBy = params.user || undefined
  const action = (params.action || undefined) as AuditAction | undefined
  const actorType = (params.actor_type || undefined) as AuditActorType | undefined
  const startDate = params.start || undefined
  // End date is inclusive in the UI but we query exclusive — bump by one day.
  let endDate: string | undefined
  if (params.end) {
    const d = new Date(params.end)
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1)
      endDate = d.toISOString().slice(0, 10)
    }
  }

  // WO# resolution: server-side lookup of pm_tickets + service_tickets by
  // work_order_number, then pass the matching UUIDs into the entityIds filter.
  let entityIds: string[] | undefined
  let woUnmatched = false
  if (params.wo) {
    const woNum = parseInt(params.wo, 10)
    if (Number.isFinite(woNum) && woNum > 0) {
      entityIds = await findTicketsByWorkOrder(woNum)
      if (entityIds.length === 0) woUnmatched = true
    } else {
      woUnmatched = true
      entityIds = []
    }
  }

  const [{ events, total }, { actors, truncated: actorsTruncated }] = await Promise.all([
    listAuditEvents({
      entityType, entityIds, changedBy, action, actorType, startDate, endDate,
      limit: PAGE_SIZE, offset,
    }),
    listAuditActors(),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(entityType || changedBy || action || actorType || startDate || params.end || params.wo)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Audit Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Every change to service tickets, PM tickets, equipment, schedules, customers, and users. Newest first.
        </p>
      </div>

      <form
        method="GET"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 p-4 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
      >
        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">WO #</span>
          <input
            type="number"
            inputMode="numeric"
            name="wo"
            placeholder="e.g. 1842"
            defaultValue={params.wo ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">Entity</span>
          <select
            name="entity"
            defaultValue={params.entity ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>{ENTITY_LABELS[e]}</option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">User</span>
          <select
            name="user"
            defaultValue={params.user ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">All</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {actorsTruncated && (
            <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">
              Recent actors only — older ones may be missing
            </span>
          )}
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">Action</span>
          <select
            name="action"
            defaultValue={params.action ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">All</option>
            <option value="insert">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Deleted</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">Actor type</span>
          <select
            name="actor_type"
            defaultValue={params.actor_type ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">All</option>
            <option value="user">User</option>
            <option value="customer">Customer</option>
            <option value="system">System</option>
            <option value="sync">Sync</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">From</span>
          <input
            type="date"
            name="start"
            defaultValue={params.start ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="text-sm">
          <span className="block text-gray-500 dark:text-gray-400 mb-1">To</span>
          <input
            type="date"
            name="end"
            defaultValue={params.end ?? ''}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </label>

        <div className="sm:col-span-2 lg:col-span-7 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {total.toLocaleString()} event{total === 1 ? '' : 's'}
            {hasFilters ? ' matching filters' : ' total'}
            {woUnmatched && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                No ticket found for WO #{params.wo}.
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Link
                href="/admin/audit-log"
                className="text-sm px-3 py-1.5 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Reset
              </Link>
            )}
            <button
              type="submit"
              className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Apply filters
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
        <ScrollableTable>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No events match these filters yet.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {formatOccurredAt(e.occurred_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-900 dark:text-gray-100">{actorDisplayName(e)}</div>
                    {e.actor?.role && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{e.actor.role}</div>
                    )}
                    {!e.actor && e.actor_type !== 'user' && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{e.actor_type}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-900 dark:text-gray-100">{entityLabel(e.entity_type)}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">#{e.entity_id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {changeSummary(e)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-300">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <Link
                  href={`/admin/audit-log${buildQs(params, { page: String(page - 1) })}`}
                  className="px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  ← Newer
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/admin/audit-log${buildQs(params, { page: String(page + 1) })}`}
                  className="px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Older →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionBadge({ action }: { action: 'insert' | 'update' | 'delete' }) {
  const styles =
    action === 'insert'
      ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      : action === 'delete'
        ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {ACTION_LABELS[action]}
    </span>
  )
}
