'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MapPin, MapPinPlus, Check, X, Wrench, ClipboardList } from 'lucide-react'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'
import QueueActionCard from '@/components/ui/QueueActionCard'
import type { ShipToRequestWithJoins } from '@/lib/db/ship-to-requests'
import type { ShipToLocationRow } from '@/types/database'
import { groupShipToRequests, type ShipToRequestGroup } from '@/lib/ship-to-requests/group'
import { findLikelyShipTos, type ShipToMatch } from '@/lib/ship-to-requests/match'

type Tab = 'pending' | 'resolved' | 'dismissed'

type CreateForm = {
  synergy_shiplist_code: string
  name: string
  address: string
  city: string
  state: string
  zip: string
}

const EMPTY_FORM: CreateForm = {
  synergy_shiplist_code: '',
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

// Same aging ramp as /pickup-queue, so a red pill means the same thing on both pages.
function agingBadge(days: number): { label: string; classes: string } {
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 7) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 14) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  if (days <= 30) return { label, classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function locationLabel(l: ShipToLocationRow): string {
  return l.name?.trim() || l.address?.trim() || `Ship-to ${l.synergy_shiplist_code}`
}

function locationAddress(l: ShipToLocationRow): string {
  return [l.address, l.city, l.state, l.zip].filter(Boolean).join(', ')
}

const INPUT_CLASS =
  'mt-1 w-full min-h-[44px] px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white'
const LABEL_CLASS = 'text-xs font-medium text-gray-700 dark:text-gray-300'

// Subcomponents live at module level. Defined inside the page component they
// would be a new component type on every render, and the create form's inputs
// would drop focus after each keystroke (wiki/feedback/no-inner-components.md).

function AgeBadge({ days }: { days: number }) {
  const { label, classes } = agingBadge(days)
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  )
}

function SourceTicketLinks({ rows }: { rows: ShipToRequestWithJoins[] }) {
  const links = rows
    .map((r) =>
      r.pm_ticket_id
        ? { href: `/tickets/${r.pm_ticket_id}`, label: 'PM ticket' }
        : r.service_ticket_id
          ? { href: `/service/${r.service_ticket_id}`, label: 'Service ticket' }
          : null
    )
    .filter((l): l is { href: string; label: string } => l !== null)

  // Duplicate requests usually point at the same ticket.
  const unique = links.filter((l, i) => links.findIndex((o) => o.href === l.href) === i)
  if (unique.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {unique.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {l.label}
        </Link>
      ))}
    </div>
  )
}

function EquipmentLine({ group }: { group: ShipToRequestGroup }) {
  const eq = group.rows.find((r) => r.equipment)?.equipment
  if (!eq) return null
  const text = [eq.make, eq.model, eq.serial_number ? `SN ${eq.serial_number}` : null]
    .filter(Boolean)
    .join(' ')
  if (!text) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <Wrench className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function MatchSuggestions({
  matches,
  busy,
  onLink,
}: {
  matches: ShipToMatch[]
  busy: boolean
  onLink: (shipToId: number) => void
}) {
  if (matches.length === 0) return null
  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
      <p className="text-xs font-medium text-blue-900 dark:text-blue-300">
        {matches.length === 1
          ? 'This location may already exist'
          : 'These locations may already exist'}
      </p>
      {matches.map((m) => (
        <div key={m.location.id} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm text-gray-900 dark:text-white truncate">
              {locationLabel(m.location)}
              {m.location.provisional && (
                <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                  Pending sync
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {locationAddress(m.location) || 'No address on file'}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onLink(m.location.id)}
            className="min-h-[44px] sm:min-h-0 sm:py-1.5 px-3 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            Link this location
          </button>
        </div>
      ))}
    </div>
  )
}

function CreateLocationForm({
  form,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CreateForm
  busy: boolean
  onChange: (patch: Partial<CreateForm>) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const codeTouched = form.synergy_shiplist_code.trim().length > 0
  const codeValid = /^\d+$/.test(form.synergy_shiplist_code.trim())
  const canSubmit = codeValid && form.name.trim().length > 0 && !busy

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Add the location in Synergy first, then enter its ship-to code here. The tech can use it
        straight away, and tonight&apos;s sync fills in the rest and confirms it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={LABEL_CLASS}>
          Synergy ship-to code
          <input
            value={form.synergy_shiplist_code}
            onChange={(e) => onChange({ synergy_shiplist_code: e.target.value })}
            inputMode="numeric"
            placeholder="e.g. 12"
            className={INPUT_CLASS}
          />
        </label>
        <label className={LABEL_CLASS}>
          Location name
          <input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. CRESTLINE ELEMENTARY"
            className={INPUT_CLASS}
          />
        </label>
        <label className={`${LABEL_CLASS} sm:col-span-2`}>
          Address
          <input
            value={form.address}
            onChange={(e) => onChange({ address: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className={LABEL_CLASS}>
          City
          <input
            value={form.city}
            onChange={(e) => onChange({ city: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL_CLASS}>
            State
            <input
              value={form.state}
              onChange={(e) => onChange({ state: e.target.value })}
              maxLength={2}
              className={INPUT_CLASS}
            />
          </label>
          <label className={LABEL_CLASS}>
            ZIP
            <input
              value={form.zip}
              onChange={(e) => onChange({ zip: e.target.value })}
              inputMode="numeric"
              className={INPUT_CLASS}
            />
          </label>
        </div>
      </div>
      {codeTouched && !codeValid && (
        <p className="text-xs text-red-600 dark:text-red-400">
          The Synergy ship-to code is numeric.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="min-h-[44px] px-4 rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {busy ? 'Saving...' : 'Create and resolve'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-[44px] px-4 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ClosedRequestCard({
  group,
  locationsById,
}: {
  group: ShipToRequestGroup
  locationsById: Map<number, ShipToLocationRow>
}) {
  const r = group.primary
  const linked = r.resolved_ship_to_id ? locationsById.get(r.resolved_ship_to_id) : null
  return (
    <QueueActionCard
      title={
        <span>
          {r.customer?.name ?? 'Unknown customer'}
          {group.count > 1 && (
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">x{group.count}</span>
          )}
        </span>
      }
      sub={
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Requested {formatDate(r.requested_at)} by {group.requesterNames.join(', ') || 'a tech'}
        </p>
      }
      badge={
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 whitespace-nowrap">
          {formatDate(r.resolved_at)}
        </span>
      }
    >
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
        {r.note}
      </p>
      {linked && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Linked to {locationLabel(linked)}
        </p>
      )}
    </QueueActionCard>
  )
}

export default function ShipToRequestsClient({
  pending,
  resolved,
  dismissed,
  locations,
}: {
  pending: ShipToRequestWithJoins[]
  resolved: ShipToRequestWithJoins[]
  dismissed: ShipToRequestWithJoins[]
  locations: ShipToLocationRow[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const pendingGroups = useMemo(() => groupShipToRequests(pending), [pending])
  const resolvedGroups = useMemo(() => groupShipToRequests(resolved), [resolved])
  const dismissedGroups = useMemo(() => groupShipToRequests(dismissed), [dismissed])

  const locationsByCustomer = useMemo(() => {
    const m = new Map<number, ShipToLocationRow[]>()
    for (const l of locations) {
      if (l.customer_id == null) continue
      const bucket = m.get(l.customer_id)
      if (bucket) bucket.push(l)
      else m.set(l.customer_id, [l])
    }
    return m
  }, [locations])

  const locationsById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  /**
   * Apply one status change across every id in a group.
   *
   * Sequential on purpose. Groups are tiny (five at worst in the live backlog) and
   * this reuses the single-id PATCH with its cross-customer guard and its
   * `.eq('status','pending')` idempotency clause, rather than adding an untested
   * bulk path. A partial failure is reported rather than swallowed.
   */
  async function patchGroup(
    group: ShipToRequestGroup,
    body: { status: 'resolved' | 'dismissed'; resolved_ship_to_id?: number }
  ) {
    setBusyKey(group.key)
    setError(null)
    let done = 0
    let firstError: string | null = null

    for (const id of group.ids) {
      try {
        const res = await fetch(`/api/ship-to-requests/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          done += 1
        } else {
          const b = await res.json().catch(() => ({}))
          firstError = firstError ?? (b?.error || 'Update failed')
        }
      } catch {
        firstError = firstError ?? 'Network error'
      }
    }

    setBusyKey(null)

    if (done < group.ids.length) {
      const noun = group.ids.length === 1 ? 'request' : 'requests'
      setError(
        `Updated ${done} of ${group.ids.length} ${noun}. ${firstError ?? ''}`.trim()
      )
    } else {
      setCreatingKey(null)
      setForm(EMPTY_FORM)
    }
    router.refresh()
  }

  async function createAndResolve(group: ShipToRequestGroup) {
    setBusyKey(group.key)
    setError(null)
    try {
      const res = await fetch('/api/ship-to-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: group.primary.customer_id,
          synergy_shiplist_code: form.synergy_shiplist_code.trim(),
          name: form.name.trim(),
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          zip: form.zip.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBusyKey(null)
        setError(body?.error || 'Could not create the location')
        return
      }
      const shipToId = body?.ship_to?.id
      if (typeof shipToId !== 'number') {
        setBusyKey(null)
        setError('The location was created but returned no id')
        return
      }
      await patchGroup(group, { status: 'resolved', resolved_ship_to_id: shipToId })
    } catch {
      setBusyKey(null)
      setError('Network error creating the location')
    }
  }

  const tabs = [
    { key: 'pending', label: 'Pending', count: pendingGroups.length },
    { key: 'resolved', label: 'Resolved', count: resolvedGroups.length },
    { key: 'dismissed', label: 'Dismissed', count: dismissedGroups.length },
  ]

  return (
    <div className="space-y-4">
      <Tabs
        tabs={tabs}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        ariaLabel="Ship-to request status"
      />

      {error && <InlineError message={error} />}

      {tab === 'pending' && (
        <div className="space-y-3">
          {pendingGroups.length === 0 ? (
            <EmptyState
              icon={MapPin}
              message="No ship-to requests are waiting. Nothing to do here."
            />
          ) : (
            pendingGroups.map((group) => {
              const busy = busyKey === group.key
              const isCreating = creatingKey === group.key
              const matches = findLikelyShipTos(
                group.primary.note,
                locationsByCustomer.get(group.primary.customer_id) ?? []
              )
              const repeats = group.count - 1

              return (
                <QueueActionCard
                  key={group.key}
                  title={
                    <span>
                      {group.primary.customer?.name ?? 'Unknown customer'}
                      {group.count > 1 && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300">
                          x{group.count}
                        </span>
                      )}
                    </span>
                  }
                  sub={
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {group.requesterNames.join(', ') || 'A tech'} &middot; first asked{' '}
                        {formatDate(group.oldestRequestedAt)}
                        {repeats > 0 &&
                          `, asked again ${repeats} more time${repeats > 1 ? 's' : ''}`}
                      </p>
                      <EquipmentLine group={group} />
                      <SourceTicketLinks rows={group.rows} />
                    </div>
                  }
                  badge={<AgeBadge days={daysSince(group.oldestRequestedAt)} />}
                  footer={
                    !isCreating && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setCreatingKey(group.key)
                            setForm({
                              ...EMPTY_FORM,
                              address: group.primary.note.split('\n')[0]?.trim() ?? '',
                            })
                            setError(null)
                          }}
                          className="min-h-[44px] px-4 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-1.5"
                        >
                          <MapPinPlus className="h-4 w-4" />
                          Add it now
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => patchGroup(group, { status: 'dismissed' })}
                          className="min-h-[44px] px-4 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm font-medium text-gray-700 dark:text-gray-300 inline-flex items-center justify-center gap-1.5"
                        >
                          <X className="h-4 w-4" />
                          {group.count > 1 ? `Dismiss all ${group.count}` : 'Dismiss'}
                        </button>
                      </div>
                    )
                  }
                  expanded={
                    isCreating && (
                      <CreateLocationForm
                        form={form}
                        busy={busy}
                        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                        onSubmit={() => createAndResolve(group)}
                        onCancel={() => {
                          setCreatingKey(null)
                          setForm(EMPTY_FORM)
                          setError(null)
                        }}
                      />
                    )
                  }
                >
                  <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                    {group.primary.note}
                  </p>
                  <MatchSuggestions
                    matches={matches}
                    busy={busy}
                    onLink={(shipToId) =>
                      patchGroup(group, { status: 'resolved', resolved_ship_to_id: shipToId })
                    }
                  />
                </QueueActionCard>
              )
            })
          )}
        </div>
      )}

      {tab === 'resolved' && (
        <div className="space-y-3">
          {resolvedGroups.length === 0 ? (
            <EmptyState icon={Check} message="No requests have been resolved yet." />
          ) : (
            resolvedGroups.map((g) => (
              <ClosedRequestCard key={g.key} group={g} locationsById={locationsById} />
            ))
          )}
        </div>
      )}

      {tab === 'dismissed' && (
        <div className="space-y-3">
          {dismissedGroups.length === 0 ? (
            <EmptyState icon={ClipboardList} message="Nothing has been dismissed." />
          ) : (
            dismissedGroups.map((g) => (
              <ClosedRequestCard key={g.key} group={g} locationsById={locationsById} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
