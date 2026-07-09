import { getCurrentUser, AUDIT_ROLES } from '@/lib/auth'
import { listAuditEventsForEntity } from '@/lib/db/auditEvents'
import {
  actorDisplayName,
  formatOccurredAt,
  formatDiff,
  renderValue,
  columnLabel,
  ACTION_LABELS,
  type AuditEventWithActor,
  type FormattedDiffEntry,
} from '@/lib/audit/format'

type Props = {
  entityType: string
  entityId: string
  limit?: number
}

// Autosave storms (e.g. the completion form's 3s-debounced save) produce
// many same-actor, same-field UPDATE rows seconds apart. Collapsing them
// keeps every row in the underlying data — this is render-layer grouping
// only — while stopping them from dominating the feed visually.
const AUTOSAVE_WINDOW_MS = 15 * 60 * 1000 // 15 min between first and last in a run
const AUTOSAVE_MIN_RUN = 4 // collapse runs of MORE than 3 (i.e. 4+)

type RenderRow =
  | { type: 'event'; event: AuditEventWithActor }
  | { type: 'autosave-group'; events: AuditEventWithActor[] }

function actorKey(e: AuditEventWithActor): string {
  return e.actor?.id ?? e.changed_by ?? e.actor_label ?? e.actor_type
}

function fieldSignature(e: AuditEventWithActor): string {
  return Object.keys(e.changes ?? {}).sort().join('|')
}

// Groups consecutive (already newest-first) events into autosave runs.
// A run only collapses when it's the same actor, the same set of changed
// field keys, every step lands within AUTOSAVE_WINDOW_MS of the run's start,
// and the run is longer than AUTOSAVE_MIN_RUN - 1. Anything shorter renders
// as normal individual entries.
function groupAutosaveNoise(events: AuditEventWithActor[]): RenderRow[] {
  const rows: RenderRow[] = []
  let i = 0
  while (i < events.length) {
    const anchor = events[i]
    const sig = fieldSignature(anchor)
    const actor = actorKey(anchor)
    let j = i + 1
    if (anchor.action === 'update' && sig !== '') {
      const anchorTime = new Date(anchor.occurred_at).getTime()
      while (
        j < events.length &&
        events[j].action === 'update' &&
        actorKey(events[j]) === actor &&
        fieldSignature(events[j]) === sig &&
        Math.abs(new Date(events[j].occurred_at).getTime() - anchorTime) <= AUTOSAVE_WINDOW_MS
      ) {
        j++
      }
    }

    const run = events.slice(i, j)
    if (run.length >= AUTOSAVE_MIN_RUN) {
      rows.push({ type: 'autosave-group', events: run })
    } else {
      for (const e of run) rows.push({ type: 'event', event: e })
    }
    i = j
  }
  return rows
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
  const rows = groupAutosaveNoise(events)

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <details className="group">
        <summary className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 cursor-pointer select-none flex items-center justify-between gap-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              History ({events.length})
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Every recorded change to this record, newest first. Visible to managers and admins only.
            </p>
          </div>
          <svg
            className="h-4 w-4 text-gray-400 dark:text-gray-500 transition-transform group-open:rotate-180 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        {events.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
            No recorded changes yet.
          </div>
        ) : (
          <ol className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) =>
              row.type === 'event' ? (
                <EventItem key={row.event.id} event={row.event} />
              ) : (
                <AutosaveGroupItem key={`group-${row.events[0].id}`} group={row.events} />
              ),
            )}
          </ol>
        )}
      </details>
    </section>
  )
}

// One row per changed field. Complex (array/object) values render the
// humanized headline with a "Show detail" disclosure for the per-item
// lines instead of dumping raw JSON. Primitives keep the old -> new
// strikethrough presentation.
function DiffRow({ d }: { d: FormattedDiffEntry }) {
  if (d.isComplex && d.summary) {
    return (
      <div className="flex gap-2">
        <span className="text-gray-500 dark:text-gray-400 min-w-[140px] shrink-0">{d.label}</span>
        <div className="text-gray-700 dark:text-gray-300 min-w-0">
          <span>{d.summary.headline}</span>
          {d.summary.lines.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none">
                Show detail
              </summary>
              <div className="mt-1 space-y-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-400">
                {d.summary.lines.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 dark:text-gray-400 min-w-[140px] shrink-0">{d.label}</span>
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
  )
}

function DiffList({ event }: { event: AuditEventWithActor }) {
  const diff = formatDiff(event)
  if (diff.length === 0) return null
  return (
    <div className="mt-1 text-xs space-y-1">
      {diff.map((d) => (
        <DiffRow key={d.key} d={d} />
      ))}
    </div>
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
              <DiffRow key={d.key} d={d} />
            ))}
          </div>
        </details>
      )}

      {event.action === 'update' && diff.length > 0 && <DiffList event={event} />}
    </li>
  )
}

// A collapsed run of autosave edits. The summary line stays a single row
// ("N autosave edits to Field") but every underlying event — timestamp and
// full humanized diff — is still reachable behind the disclosure; nothing
// is dropped from the data, only visually grouped.
function AutosaveGroupItem({ group }: { group: AuditEventWithActor[] }) {
  const first = group[0]
  const last = group[group.length - 1]
  const fieldKeys = Object.keys(first.changes ?? {}).sort()
  const fieldLabels = fieldKeys.map((k) => columnLabel(first.entity_type, k)).join(', ')

  return (
    <li className="px-4 py-3">
      <details>
        <summary className="cursor-pointer select-none list-none">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {actorDisplayName(first)}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {' '}
                {group.length} autosave edits to {fieldLabels || 'this record'}
              </span>
            </div>
            <time className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {formatOccurredAt(last.occurred_at)} - {formatOccurredAt(first.occurred_at)}
            </time>
          </div>
        </summary>
        <ol className="mt-2 space-y-3 border-l border-gray-200 dark:border-gray-800 pl-3">
          {group.map((e) => (
            <li key={e.id}>
              <time className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatOccurredAt(e.occurred_at)}
              </time>
              <DiffList event={e} />
            </li>
          ))}
        </ol>
      </details>
    </li>
  )
}
