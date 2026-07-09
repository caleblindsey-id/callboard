'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Search, Plus, AlertCircle, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'

type ShipTo = {
  id: number
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

interface Props {
  ticketId: string
  customerId: number
  equipmentId: string | null
  currentShipToId: number | null
  // POST target for the relocate. PM and service use different routes.
  relocateUrl: string
  // Which column a "request a new ship-to" links to. Defaults to PM.
  requestTicketField?: 'pm_ticket_id' | 'service_ticket_id'
  // How a pick is applied:
  //   'relocate-equipment' (default) — POST relocateUrl; moves the equipment's home location.
  //   'set-ticket-shipto' — PATCH the ticket's ship_to_location_id directly. Used for tickets
  //     with no linked equipment (e.g. Synergy imports), where relocate has nothing to move.
  applyMode?: 'relocate-equipment' | 'set-ticket-shipto'
  // PATCH target when applyMode === 'set-ticket-shipto'.
  patchUrl?: string
}

type View = 'closed' | 'pick' | 'confirm' | 'request'

export default function ChangeLocationSection({
  ticketId,
  customerId,
  equipmentId,
  currentShipToId,
  relocateUrl,
  requestTicketField = 'pm_ticket_id',
  applyMode = 'relocate-equipment',
  patchUrl,
}: Props) {
  const setTicketMode = applyMode === 'set-ticket-shipto'
  const router = useRouter()
  const [view, setView] = useState<View>('closed')
  const [shipTos, setShipTos] = useState<ShipTo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ShipTo | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [requestNote, setRequestNote] = useState('')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    if (view !== 'pick' || shipTos !== null) return
    let cancelled = false
    setLoading(true)
    const supabase = createClient()
    supabase
      .from('ship_to_locations')
      .select('id, name, address, city, state, zip')
      .eq('customer_id', customerId)
      .order('address', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
        } else {
          setShipTos((data ?? []) as ShipTo[])
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, customerId, shipTos])

  function open() {
    setError(null)
    setSuccessMsg(null)
    setSearch('')
    setSelected(null)
    setView('pick')
  }
  function close() {
    setView('closed')
    setError(null)
    setSelected(null)
    setRequestNote('')
  }

  const filtered = useMemo(() => {
    if (!shipTos) return []
    const q = search.trim().toLowerCase()
    const list = shipTos.filter((s) => s.id !== currentShipToId)
    if (!q) return list
    return list.filter((s) => {
      const blob = [s.name, s.address, s.city, s.state, s.zip]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [shipTos, search, currentShipToId])

  async function submitRelocate() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      // Equipment-less tickets: PATCH the ticket's ship-to directly (no equipment to move).
      const res = setTicketMode
        ? await fetch(patchUrl ?? relocateUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ship_to_location_id: selected.id }),
          })
        : await fetch(relocateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ship_to_location_id: selected.id }),
          })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || (setTicketMode ? 'Failed to set ship-to' : 'Failed to relocate'))
      setView('closed')
      setSuccessMsg(setTicketMode ? 'Ship-to set.' : 'Equipment moved.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update location')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRequest() {
    if (!requestNote.trim()) {
      setError('Describe the new location before submitting.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/ship-to-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          [requestTicketField]: ticketId,
          equipment_id: equipmentId,
          note: requestNote.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send request')
      setRequestNote('')
      setView('closed')
      setSuccessMsg('Office has been notified.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 min-h-[44px] sm:min-h-0 px-2 -mx-2"
      >
        <MapPin className="h-4 w-4" />
        {setTicketMode && currentShipToId === null ? 'Set location' : 'Change location'}
      </button>

      {successMsg && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Check className="h-4 w-4" /> {successMsg}
        </p>
      )}

      {view === 'pick' && (
        <PickSheet
          loading={loading}
          shipTos={filtered}
          rawCount={shipTos?.length ?? 0}
          search={search}
          onSearch={setSearch}
          onPick={(s) => {
            setSelected(s)
            setView('confirm')
          }}
          onRequestNew={() => {
            setError(null)
            setView('request')
          }}
          onClose={close}
          error={error}
        />
      )}

      {view === 'confirm' && selected && (
        <ConfirmSheet
          target={selected}
          description={
            setTicketMode
              ? 'This sets the ship-to location for this ticket.'
              : "This updates the equipment's home location. Future PMs for this equipment will default to the new ship-to."
          }
          confirmLabel={setTicketMode ? 'Set Location' : 'Confirm Move'}
          submittingLabel={setTicketMode ? 'Saving...' : 'Moving...'}
          onConfirm={submitRelocate}
          onBack={() => setView('pick')}
          submitting={submitting}
          error={error}
        />
      )}

      {view === 'request' && (
        <RequestSheet
          note={requestNote}
          onChange={setRequestNote}
          onSubmit={submitRequest}
          onBack={() => setView('pick')}
          submitting={submitting}
          error={error}
        />
      )}
    </>
  )
}

function SheetBack({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1"
    >
      Back
    </button>
  )
}

function PickSheet({
  loading,
  shipTos,
  rawCount,
  search,
  onSearch,
  onPick,
  onRequestNew,
  onClose,
  error,
}: {
  loading: boolean
  shipTos: ShipTo[]
  rawCount: number
  search: string
  onSearch: (v: string) => void
  onPick: (s: ShipTo) => void
  onRequestNew: () => void
  onClose: () => void
  error: string | null
}) {
  return (
    <Modal open onClose={onClose} title="Change Location" sheet size="lg">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search address, city, ZIP..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading ship-tos...</p>
        )}
        {error && (
          <p className="p-4 text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
        {!loading && !error && rawCount === 0 && (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
            No ship-to locations on file for this customer.
          </p>
        )}
        {!loading && !error && rawCount > 0 && shipTos.length === 0 && (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
            No matches. Try a different search, or request a new location.
          </p>
        )}
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {shipTos.map((s) => {
            const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ')
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 min-h-[64px]"
                >
                  {s.name && (
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</p>
                  )}
                  <p className="text-sm text-gray-700 dark:text-gray-300">{addr || '—'}</p>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onRequestNew}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-md min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          Don&apos;t see it? Request a new location
        </button>
      </div>
    </Modal>
  )
}

function ConfirmSheet({
  target,
  description,
  confirmLabel,
  submittingLabel,
  onConfirm,
  onBack,
  submitting,
  error,
}: {
  target: ShipTo
  description: string
  confirmLabel: string
  submittingLabel: string
  onConfirm: () => void
  onBack: () => void
  submitting: boolean
  error: string | null
}) {
  const addr = [target.address, target.city, target.state, target.zip].filter(Boolean).join(', ')
  return (
    <Modal open onClose={onBack} title="Confirm Location" headerLeft={<SheetBack onBack={onBack} />} sheet size="lg" dismissible={!submitting}>
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">{description}</p>
        <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-700">
          {target.name && (
            <p className="text-sm font-medium text-gray-900 dark:text-white">{target.name}</p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">{addr || '—'}</p>
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 min-h-[44px]"
        >
          {submitting ? submittingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

function RequestSheet({
  note,
  onChange,
  onSubmit,
  onBack,
  submitting,
  error,
}: {
  note: string
  onChange: (v: string) => void
  onSubmit: () => void
  onBack: () => void
  submitting: boolean
  error: string | null
}) {
  return (
    <Modal open onClose={onBack} title="Request New Ship-To" headerLeft={<SheetBack onBack={onBack} />} sheet size="lg" dismissible={!submitting}>
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Describe the new location. The office will add it to Synergy and link it back to this
          ticket.
        </p>
        <textarea
          value={note}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="e.g. 1234 Industrial Blvd, Suite 200, Birmingham AL 35203 — back loading dock"
          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 min-h-[44px]"
        >
          {submitting ? 'Sending...' : 'Send Request'}
        </button>
      </div>
    </Modal>
  )
}
