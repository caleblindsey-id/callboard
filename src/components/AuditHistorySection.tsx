import { getCurrentUser, AUDIT_ROLES } from '@/lib/auth'
import { listAuditEventsForEntity } from '@/lib/db/auditEvents'
import {
  actorDisplayName,
  formatOccurredAt,
  formatDiff,
  renderValue,
  ACTION_LABELS,
  type AuditEventWithActor,
} from '@/lib/audit/format'

type Props = {
  entityType: string
  entityId: string
  limit?: number
}

// Visibility: super_admin + manager (AUDIT_ROLES). Rendered server-side, so
// non-authorized users get nothing at all in the HTML — no client check to
// leak. Matches the global audit-log page's gating.
export default async function AuditHistorySection({
  entityType,
  entityId,
  limit = 50,
}: Props) {
  const user = await getCurrentUser()
  if (!user?.role || !AUDIT_ROLES.includes(user.role)) {
    return null
  }

  const events = await listAuditEventsForEntity(entityType, entityId, limit)

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <header className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">History</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Every recorded change to this record, newest first. Super-admin only.
        </p>
      </header>
      {events.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
          No recorded changes yet.
        </div>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-gray-800">
          {events.map((e) => (
            <EventItem key={e.id} event={e} />
          ))}
        </ol>
      )}
    </section>
  )
}

function EventItem({ event }: { event: AuditEventWithActor }) {
  const diff = formatDiff(event)
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {actorDisplayName(event)}
          </span>
          <span className="text-gray-500 dark:text-gray-400"> {ACTION_LABELS[event.action]}</span>
          {event.actor?.role && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">({event.actor.role})</span>
          )}
        </div>
        <time className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {formatOccurredAt(event.occurred_at)}
        </time>
      </div>

      {event.action !== 'update' && diff.length > 0 && (
        <details className="mt-1">
          <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
            {diff.length} field{diff.length === 1 ? '' : 's'} captured
          </summary>
          <div className="mt-2 text-xs space-y-1">
            {diff.map((d) => (
              <div key={d.key} className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 min-w-[140px]">{d.label}</span>
                <span className="text-gray-800 dark:text-gray-200 break-all">
                  {d.kind === 'value' ? renderValue(d.value) : renderValue(d.new)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {event.action === 'update' && diff.length > 0 && (
        <div className="mt-2 text-xs space-y-1">
          {diff.map((d) => (
            <div key={d.key} className="flex gap-2">
              <span className="text-gray-500 dark:text-gray-400 min-w-[140px]">{d.label}</span>
              <span className="text-gray-700 dark:text-gray-300 break-all">
                {d.kind === 'pair' ? (
                  <>
                    <span className="line-through opacity-60">{renderValue(d.old)}</span>
                    <span className="mx-1">→</span>
                    <span className="text-gray-900 dark:text-gray-100">{renderValue(d.new)}</span>
                  </>
                ) : (
                  renderValue(d.value)
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
