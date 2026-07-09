'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TicketDetail } from '@/lib/db/tickets'
import { PartRequest, PartUsed, TicketPhoto, UserRole, TicketStatus } from '@/types/database'
import { VALID_TRANSITIONS } from '@/lib/ticket-transitions'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import ConfirmDialog from '@/components/ConfirmDialog'
import { equipmentNeedsVerification } from '@/lib/equipment'
import type { SkipRequestPayload } from './SkipRequestForm'
import { partsOnOrder } from '@/lib/parts'
import { calcNextServiceMonth } from '@/lib/utils/schedule'
import { useFormDraft } from '@/lib/hooks/useFormDraft'
import TicketNextStepBar from './TicketNextStepBar'
import UnassignedAssignedPanel from './panels/UnassignedAssignedPanel'
import InProgressPanel from './panels/InProgressPanel'
import SkipRequestedPanel from './panels/SkipRequestedPanel'
import SkippedPanel from './panels/SkippedPanel'
import CompletedBilledPanel from './panels/CompletedBilledPanel'

export interface ProductResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
  // Catch-all items (e.g. "SHOP SUPPLIES") set this so the entry form prompts
  // for a free-text detail of what the supplies actually were.
  requires_detail?: boolean
}

export interface PartEntry {
  description: string
  // quantity/unitPrice are kept as raw input strings (mirroring hoursWorked)
  // so the fields can be empty instead of showing a stray leading "0"/"1"
  // that the user has to delete. Parsed with parseFloat at the use sites.
  quantity: string
  unitPrice: string
  synergyProductId: number | null
  isFromDb: boolean
  searchOpen: boolean
  searchResults: ProductResult[]
  searching: boolean
  // True when the selected catalog item is flagged products.requires_detail
  // (e.g. SHOP SUPPLIES). Persisted so the detail input survives reload.
  requiresDetail?: boolean
  // Free-text "what were the supplies". Optional.
  detail?: string
}

// Local (localStorage) safety net for the in_progress completion form — the
// 3s server autosave (saveProgress below) is still authoritative; this is
// what survives an offline/airplane-mode session between saves. Deliberately
// excludes photos and the signature (large/binary, mirrors the "photos
// aren't saved in drafts" convention in SubmitLeadModal).
interface PmCompletionDraft {
  completedDate: string
  hoursWorked: string
  machineHours: string
  dateCode: string
  completionNotes: string
  pmParts: PartEntry[]
  additionalParts: PartEntry[]
  additionalHoursWorked: string
  tripChargeQty: string
  billingContactName: string
  billingContactEmail: string
  billingContactPhone: string
  aceLaborOpen: boolean
  aceHours: string
  aceReason: string
}

interface TicketActionsProps {
  ticket: TicketDetail
  userRole: UserRole | null
  userId: string | null
  laborRate: number
  tripChargeRate: number
}



function partsFromSaved(saved: PartUsed[]): PartEntry[] {
  return saved.map((p) => ({
    description: p.description,
    quantity: String(p.quantity),
    unitPrice: String(p.unit_price),
    synergyProductId: p.synergy_product_id,
    isFromDb: p.synergy_product_id != null,
    searchOpen: false,
    searchResults: [],
    searching: false,
    // Restore the detail input on reload (the product-select event that sets
    // requiresDetail never fires again on rehydrate).
    requiresDetail: !!p.requires_detail,
    detail: p.detail ?? '',
  }))
}

function partsFromDefaults(defaults: { synergy_product_id: number; quantity: number; description: string }[]): PartEntry[] {
  return defaults.map((d) => ({
    description: d.description,
    quantity: String(d.quantity),
    unitPrice: '0',
    synergyProductId: d.synergy_product_id,
    isFromDb: true,
    searchOpen: false,
    searchResults: [],
    searching: false,
  }))
}

// ── Completion seed from requested parts ─────────────────────────────────
// When a PM ticket has never been drafted (completion_seeded_at is null), the
// covered / billable completion sections pre-fill from the parts the office
// actually ordered (received, non-cancelled parts_requested), split by the
// tech's coverage pick. Once the first auto-save stamps completion_seeded_at,
// the saved parts_used / additional_parts_used win — so a deleted part stays
// deleted instead of silently re-seeding (and re-billing) on reopen.

function partRequestToEntry(r: PartRequest): PartEntry {
  // unit_price MUST carry through for billable manual parts: a manual part has
  // no synergy_product_id, so the completion server falls back to this
  // submitted price (drop it and the part silently bills $0).
  return partsFromSaved([{
    synergy_product_id: r.synergy_product_id ?? null,
    description: r.description,
    quantity: r.quantity,
    unit_price: r.unit_price ?? 0,
    detail: r.detail,
  }])[0]
}

function partsFromRequested(reqs: PartRequest[]): PartEntry[] {
  return reqs.map(partRequestToEntry)
}

// Covered requested parts augment the equipment defaults, de-duped by
// synergy_product_id (the billing identity — descriptions don't match because
// catalog picks are stored as "<number> - <desc>"). A manual part (null id)
// can't collide, so it's always added. Defaults win on a tie.
function mergeDefaultsWithRequestedCovered(
  defaults: { synergy_product_id: number; quantity: number; description: string }[],
  requestedCovered: PartRequest[],
): PartEntry[] {
  const defaultIds = new Set(defaults.map((d) => d.synergy_product_id))
  const extras = requestedCovered.filter(
    (r) => r.synergy_product_id == null || !defaultIds.has(r.synergy_product_id),
  )
  return [...partsFromDefaults(defaults), ...partsFromRequested(extras)]
}

function toPartUsed(entries: PartEntry[]): PartUsed[] {
  return entries.map((p) => ({
    synergy_product_id: p.synergyProductId ? Number(p.synergyProductId) : null,
    description: p.description,
    quantity: parseFloat(p.quantity) || 0,
    unit_price: parseFloat(p.unitPrice) || 0,
    // Persist only when meaningful so non-flagged parts stay lean.
    ...(p.detail?.trim() ? { detail: p.detail.trim() } : {}),
    ...(p.requiresDetail ? { requires_detail: true } : {}),
  }))
}

// Force-transition targets shown in the Super Admin override panel. Pulled
// from the shared VALID_TRANSITIONS table so client and server cannot drift.
// Completion is intentionally filtered out — the server-side PATCH route
// rejects status='completed' (must go through POST /complete).
function forceTransitionsFor(status: TicketStatus): TicketStatus[] {
  return (VALID_TRANSITIONS[status] ?? []).filter(t => t !== 'completed')
}

export default function TicketActions({ ticket, userRole, userId, laborRate, tripChargeRate }: TicketActionsProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'

  // Share work order state
  const [sharing, setSharing] = useState(false)
  const [workOrderFile, setWorkOrderFile] = useState<File | null>(null)

  const billingType = ticket.schedule?.billing_type ?? null
  const flatRate = ticket.schedule?.flat_rate ?? null
  const isFlatRate = billingType === 'flat_rate' && flatRate != null

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Completion form state — pre-populate from saved draft data
  const [completedDate, setCompletedDate] = useState(
    ticket.completed_date
      ? new Date(ticket.completed_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  )
  const [hoursWorked, setHoursWorked] = useState(
    ticket.hours_worked != null ? String(ticket.hours_worked) : ''
  )
  const [completionNotes, setCompletionNotes] = useState(
    ticket.completion_notes ?? ''
  )

  // Equipment-details gate (parity with the server gate in /api/tickets/[id]/complete):
  // a tech must enter/verify make/model/serial on the linked unit before completing.
  // Verify-once — skips for already-verified units and equipment-less tickets.
  const [equipmentJustVerified, setEquipmentJustVerified] = useState(false)
  const equipmentToVerify =
    !equipmentJustVerified && ticket.equipment && equipmentNeedsVerification(ticket.equipment)
      ? ticket.equipment
      : null
  const needsEquipmentVerify = equipmentToVerify !== null

  function handleEquipmentVerified() {
    setEquipmentJustVerified(true)
    setError(null)
    router.refresh()
  }

  // Completion seed inputs — received, non-cancelled requested parts split by
  // the tech's coverage pick. `completionSeeded` is the guard: once the first
  // auto-save stamps it, the saved draft is authoritative; before that, seed
  // from the requested parts. Unclassified (legacy) requests default to
  // billable so they surface for review rather than silently going uncharged.
  const defaultProducts = ticket.equipment?.default_products ?? []
  // Parts fulfilled (received from a PO, or pulled from stock) seed the
  // completion billing split. from_stock is billable to the customer just like a
  // received part, so it must be included or a pulled-from-stock part goes
  // uncharged.
  const requestedReceived = (ticket.parts_requested ?? []).filter(
    (r) => (r.status === 'received' || r.status === 'from_stock') && !r.cancelled,
  )
  const requestedCovered = requestedReceived.filter((r) => r.covered_by_agreement === true)
  const requestedBillable = requestedReceived.filter((r) => r.covered_by_agreement !== true)
  const completionSeeded = ticket.completion_seeded_at != null

  // PM parts (covered): saved draft once seeded; else equipment defaults +
  // covered requested parts.
  const [pmParts, setPmParts] = useState<PartEntry[]>(
    completionSeeded
      ? partsFromSaved(ticket.parts_used ?? [])
      : mergeDefaultsWithRequestedCovered(defaultProducts, requestedCovered)
  )

  // Additional work (billable): saved draft once seeded; else billable
  // requested parts.
  const [additionalParts, setAdditionalParts] = useState<PartEntry[]>(
    completionSeeded
      ? partsFromSaved(ticket.additional_parts_used ?? [])
      : partsFromRequested(requestedBillable)
  )
  const [additionalHoursWorked, setAdditionalHoursWorked] = useState(
    ticket.additional_hours_worked != null ? String(ticket.additional_hours_worked) : ''
  )
  // Trip charge = number of trips × the per-trip rate (mirrors labor). PMs are
  // flat-rate under agreement, so qty defaults to 0 — no trip charge unless a
  // manager adds one via the override field below (feedback #36). Rolls into
  // the grand total and billing_amount.
  const [tripChargeQty, setTripChargeQty] = useState(
    String(ticket.trip_charge_qty != null ? ticket.trip_charge_qty : 0)
  )

  const [machineHours, setMachineHours] = useState(
    ticket.machine_hours != null ? String(ticket.machine_hours) : ''
  )
  const [dateCode, setDateCode] = useState(ticket.date_code ?? '')

  // ACE labor — tech-payout labor on no-charge work, captured at completion.
  // Decoupled from the customer-facing billing totals above. Created via the
  // /complete endpoint in the same transaction; not part of the auto-save
  // payload (lives in its own table).
  const [aceLaborOpen, setAceLaborOpen] = useState(false)
  const [aceHours, setAceHours] = useState('')
  const [aceReason, setAceReason] = useState('')

  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')
  const [billingContactName, setBillingContactName] = useState(ticket.billing_contact_name ?? '')
  const [billingContactEmail, setBillingContactEmail] = useState(ticket.billing_contact_email ?? '')
  const [billingContactPhone, setBillingContactPhone] = useState(ticket.billing_contact_phone ?? '')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Skip request state
  const [skipRequestOpen, setSkipRequestOpen] = useState(false)
  const [skipDialogOpen, setSkipDialogOpen] = useState(false)

  // Seed the skip form's next-PM recommendation from the schedule cycle (the
  // first cycle month after this ticket's month). Falls back to next month.
  const afterMonth = (ticket.month % 12) + 1
  const afterYear = ticket.month === 12 ? ticket.year + 1 : ticket.year
  const nextCycle = ticket.schedule
    ? calcNextServiceMonth(ticket.schedule.interval_months, ticket.schedule.anchor_month, afterMonth, afterYear, new Set<string>())
    : null
  const skipDefaultMonth = nextCycle?.month ?? afterMonth
  const skipDefaultYear = nextCycle?.year ?? afterYear

  // Photo state
  const [photos, setPhotos] = useState<Array<TicketPhoto & { previewUrl?: string }>>(
    ticket.photos && ticket.photos.length > 0 ? ticket.photos : []
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-save debounce
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)
  const flushRef = useRef<() => void>(() => {})

  // Dirty-field tracking for the draft save. The save (auto or manual) must send
  // ONLY the fields this form instance actually changed — not a full snapshot.
  // Otherwise a second writer holding a stale snapshot (a duplicate tab, the PWA
  // + a browser tab, or a back-nav that left an old mount alive) auto-saves its
  // own empty/old state and silently clobbers a field it never touched. That's
  // exactly how feedback #43 lost completion notes and #42 lost the PO: a save
  // triggered by editing one field carried a stale-empty value for another and
  // nulled the persisted data. `savedFieldsRef` is the last server-known value
  // we diff against; the seed guard is stamped once per instance.
  const savedFieldsRef = useRef<Record<string, unknown> | null>(null)
  const seedStampRef = useRef<string | null>(null)
  const seedSentRef = useRef(false)

  // Load preview URLs for existing photos
  useEffect(() => {
    if (!photos.length || photos[0]?.previewUrl) return
    const supabase = createClient()
    Promise.all(
      photos.map(async (p) => {
        const { data } = await supabase.storage
          .from('ticket-photos')
          .createSignedUrl(p.storage_path, 3600)
        return { ...p, previewUrl: data?.signedUrl ?? undefined }
      })
    ).then(setPhotos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounce and combobox refs for both PM and additional parts
  const pmDebounceRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const pmComboRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const addlDebounceRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const addlComboRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      pmComboRefs.current.forEach((el, idx) => {
        if (el && !el.contains(e.target as Node)) {
          setPmParts((prev) => {
            if (!prev[idx]?.searchOpen) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], searchOpen: false }
            return updated
          })
        }
      })
      addlComboRefs.current.forEach((el, idx) => {
        if (el && !el.contains(e.target as Node)) {
          setAdditionalParts((prev) => {
            if (!prev[idx]?.searchOpen) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], searchOpen: false }
            return updated
          })
        }
      })
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Computed totals ──

  const additionalPartsTotal = additionalParts.reduce(
    (sum, p) => sum + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0), 0
  )
  const additionalLaborTotal = (parseFloat(additionalHoursWorked) || 0) * laborRate
  const additionalSubtotal = additionalLaborTotal + additionalPartsTotal
  const pmSubtotal = isFlatRate ? flatRate! : 0
  const tripChargeQtyNum = parseFloat(tripChargeQty) || 0
  const tripChargeNum = tripChargeQtyNum * tripChargeRate
  const grandTotal = pmSubtotal + additionalSubtotal + tripChargeNum

  // ── Actions ──

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start ticket')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault()

    if (needsEquipmentVerify) {
      setError('Verify the equipment details above before completing.')
      return
    }

    if (!machineHours || isNaN(parseFloat(machineHours))) {
      setError('Machine hours are required.')
      return
    }

    if (!dateCode.trim()) {
      setError('Date code is required.')
      return
    }

    if (!signatureImage || !signatureName.trim()) {
      setError('Customer signature and printed name are required.')
      return
    }

    if (aceLaborOpen) {
      const aceH = parseFloat(aceHours)
      if (!Number.isFinite(aceH) || aceH <= 0) {
        setError('ACE hours must be greater than 0, or remove the ACE Labor section.')
        return
      }
      if (!aceReason.trim()) {
        setError('ACE Labor reason is required.')
        return
      }
    }

    // from_stock + received both count as fulfilled; cancelled is skipped.
    // pending_review/requested/ordered still block (mirrors the server gate).
    const pendingParts = partsOnOrder(ticket.parts_requested)
    if (pendingParts.length > 0) {
      setError(`Cannot complete: ${pendingParts.length} part(s) are not yet received or pulled from stock.`)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completedDate,
          hoursWorked: parseFloat(hoursWorked) || 0,
          partsUsed: toPartUsed(pmParts),
          additionalPartsUsed: toPartUsed(additionalParts),
          additionalHoursWorked: parseFloat(additionalHoursWorked) || 0,
          tripChargeQty: tripChargeQtyNum,
          completionNotes,
          billingAmount: grandTotal,
          customerSignature: signatureImage,
          customerSignatureName: signatureName.trim(),
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          billingContactName: billingContactName || undefined,
          billingContactEmail: billingContactEmail || undefined,
          billingContactPhone: billingContactPhone || undefined,
          machineHours: parseFloat(machineHours),
          dateCode: dateCode.trim(),
          aceLabor: aceLaborOpen && parseFloat(aceHours) > 0
            ? { hours: parseFloat(aceHours), reason: aceReason.trim() }
            : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to complete ticket')
      }
      router.push(pathname)
      setCompleted(true)
      clearLocalDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // The full set of draft fields a save could persist, normalized exactly as
  // they go to the API. saveProgress diffs this against savedFieldsRef and only
  // sends what changed. (completion_seeded_at is handled separately below — it's
  // a write-once guard, not a user-edited field.)
  const currentSaveFields = (): Record<string, unknown> => ({
    completed_date: completedDate || null,
    hours_worked: parseFloat(hoursWorked) || null,
    completion_notes: completionNotes || null,
    parts_used: pmParts.length > 0 ? toPartUsed(pmParts) : null,
    additional_parts_used: additionalParts.length > 0 ? toPartUsed(additionalParts) : [],
    additional_hours_worked: parseFloat(additionalHoursWorked) || null,
    trip_charge_qty: tripChargeQtyNum,
    photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
    billing_contact_name: billingContactName || null,
    billing_contact_email: billingContactEmail || null,
    billing_contact_phone: billingContactPhone || null,
    machine_hours: parseFloat(machineHours) || null,
    date_code: dateCode.trim() || null,
  })

  // Snapshot the server-known baseline once, on mount, before the tech edits
  // anything — this is the reference point for dirty-diffing. Capturing it lazily
  // (e.g. on first save) would be too late: by then the edits are already in
  // state and would read as "unchanged", so they'd never be sent.
  useEffect(() => {
    if (savedFieldsRef.current === null) {
      savedFieldsRef.current = currentSaveFields()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Local draft — offline safety net for the completion form. The 3s server
  // autosave above is still authoritative; this only exists so a tech who
  // loses signal mid-completion doesn't lose the form on refresh. Keyed by
  // ticket id so switching tickets never cross-restores another WO's draft.
  const pmCompletionDraftState = useMemo<PmCompletionDraft>(() => ({
    completedDate, hoursWorked, machineHours, dateCode, completionNotes,
    pmParts, additionalParts, additionalHoursWorked, tripChargeQty,
    billingContactName, billingContactEmail, billingContactPhone,
    aceLaborOpen, aceHours, aceReason,
  }), [
    completedDate, hoursWorked, machineHours, dateCode, completionNotes,
    pmParts, additionalParts, additionalHoursWorked, tripChargeQty,
    billingContactName, billingContactEmail, billingContactPhone,
    aceLaborOpen, aceHours, aceReason,
  ])

  const { clearDraft: clearLocalDraft, lastPersistedAt: localDraftPersistedAt } = useFormDraft<PmCompletionDraft>({
    key: `pm-completion-${ticket.id}`,
    state: pmCompletionDraftState,
    enabled: ticket.status === 'in_progress',
    isMeaningful: (s) =>
      Boolean(
        s.hoursWorked.trim() ||
        s.machineHours.trim() ||
        s.dateCode.trim() ||
        s.completionNotes.trim() ||
        s.pmParts.length > 0 ||
        s.additionalParts.length > 0 ||
        s.additionalHoursWorked.trim() ||
        (parseFloat(s.tripChargeQty) || 0) > 0 ||
        s.billingContactName.trim() ||
        s.billingContactEmail.trim() ||
        s.billingContactPhone.trim() ||
        s.aceLaborOpen
      ),
    onRestore: (draft, lastEditedAt) => {
      // Server autosave (or a completed save from another session) may already
      // be newer than this device's local draft — never regress a fresher
      // server value with a stale local one.
      const serverLastSaved = new Date(ticket.updated_at).getTime()
      if (!Number.isFinite(lastEditedAt) || lastEditedAt <= serverLastSaved) return
      setCompletedDate(draft.completedDate || completedDate)
      setHoursWorked(draft.hoursWorked ?? '')
      setMachineHours(draft.machineHours ?? '')
      setDateCode(draft.dateCode ?? '')
      setCompletionNotes(draft.completionNotes ?? '')
      if (draft.pmParts) {
        setPmParts(draft.pmParts.map((p) => ({ ...p, searchOpen: false, searching: false })))
      }
      if (draft.additionalParts) {
        setAdditionalParts(draft.additionalParts.map((p) => ({ ...p, searchOpen: false, searching: false })))
      }
      setAdditionalHoursWorked(draft.additionalHoursWorked ?? '')
      setTripChargeQty(draft.tripChargeQty ?? tripChargeQty)
      setBillingContactName(draft.billingContactName ?? '')
      setBillingContactEmail(draft.billingContactEmail ?? '')
      setBillingContactPhone(draft.billingContactPhone ?? '')
      setAceLaborOpen(Boolean(draft.aceLaborOpen))
      setAceHours(draft.aceHours ?? '')
      setAceReason(draft.aceReason ?? '')
    },
  })

  // "Saved on this device" — driven by the local write succeeding, distinct
  // from `saveSuccess` (server PATCH landed). Server indicator wins when both
  // are true; see the render below.
  const [localSavedVisible, setLocalSavedVisible] = useState(false)
  useEffect(() => {
    if (localDraftPersistedAt == null) return
    setLocalSavedVisible(true)
    const t = setTimeout(() => setLocalSavedVisible(false), 3000)
    return () => clearTimeout(t)
  }, [localDraftPersistedAt])

  async function saveProgress(opts?: { keepalive?: boolean }) {
    // Send only fields that changed in THIS instance vs. the last server-known
    // baseline, so a concurrent stale writer can't overwrite untouched fields.
    const fields = currentSaveFields()
    const baseline = savedFieldsRef.current ?? {}
    const dirty: Record<string, unknown> = {}
    for (const key of Object.keys(fields)) {
      if (JSON.stringify(fields[key]) !== JSON.stringify(baseline[key])) {
        dirty[key] = fields[key]
      }
    }

    if (Object.keys(dirty).length === 0) {
      // Nothing changed here — this instance has no edits to persist, so leave
      // the row untouched (writing it would clobber another writer's fields).
      if (!opts?.keepalive) {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
      return
    }

    // Stamp the seed guard once, on this instance's first real save, only if the
    // ticket wasn't already seeded when we loaded it — so the draft becomes
    // authoritative and requested parts never re-seed over the tech's edits.
    if (ticket.completion_seeded_at == null && !seedSentRef.current) {
      if (!seedStampRef.current) seedStampRef.current = new Date().toISOString()
      dirty.completion_seeded_at = seedStampRef.current
    }

    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: opts?.keepalive ?? false,
        body: JSON.stringify(dirty),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save progress')
      }
      // Persist succeeded — advance the baseline to what we just sent so later
      // edits diff against it, and remember the seed stamp went through. (On
      // failure we leave the baseline alone so the same fields retry next save.)
      savedFieldsRef.current = fields
      if (dirty.completion_seeded_at !== undefined) seedSentRef.current = true
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      // The server round-trip landed — the local draft's job (surviving a
      // save the server never saw) is done. Server stays authoritative.
      clearLocalDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  function handleSaveProgress() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    saveProgress()
  }

  // Auto-save: debounce 3 seconds after any form field change
  useEffect(() => {
    if (ticket.status !== 'in_progress') return
    if (!hasInitialized.current) {
      hasInitialized.current = true
      return
    }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      saveProgress()
    }, 3000)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedDate, hoursWorked, machineHours, dateCode, completionNotes, pmParts, additionalParts, additionalHoursWorked, billingContactName, billingContactEmail, billingContactPhone, photos])

  // Keep the unmount-flush closure pointing at the latest state. Refreshed
  // every render so the captured saveProgress sees current field values.
  useEffect(() => {
    flushRef.current = () => {
      if (!autoSaveTimer.current) return
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
      void saveProgress({ keepalive: true })
    }
  })

  // Flush any pending debounce when the component unmounts (in-app
  // navigation via <Link>, router.push, browser back, etc.). Without this
  // the cleanup in the auto-save effect just clears the timer and the
  // tech's edits are silently dropped.
  useEffect(() => () => flushRef.current(), [])

  // Warn on hard navigation (tab close, refresh) while a save is pending.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (autoSaveTimer.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const supabase = createClient()
      const newPhotos: Array<TicketPhoto & { previewUrl?: string }> = []
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file)
        const id = crypto.randomUUID()
        const path = `${ticket.id}/${id}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('ticket-photos')
          .upload(path, compressed, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        newPhotos.push({
          storage_path: path,
          uploaded_at: new Date().toISOString(),
          previewUrl: URL.createObjectURL(compressed),
        })
      }
      setPhotos((prev) => [...prev, ...newPhotos])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePhotoDelete(index: number) {
    const photo = photos[index]
    const supabase = createClient()
    await supabase.storage.from('ticket-photos').remove([photo.storage_path])
    if (photo.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(photo.previewUrl)
    }
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  // Release any blob: object URLs we created during photo upload so the
  // browser can reclaim memory when the user navigates away mid-completion.
  // Signed-URL previews (https:) are unaffected.
  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(p.previewUrl)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePrepareWorkOrder() {
    setSharing(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/work-order-pdf`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate work order')
      }
      const blob = await res.blob()
      const customerSlug = (ticket.customers?.name ?? 'Customer').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
      const filename = `WO-${ticket.work_order_number}-${customerSlug}.pdf`
      const file = new File([blob], filename, { type: 'application/pdf' })
      setWorkOrderFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate work order')
    } finally {
      setSharing(false)
    }
  }

  async function handleShareWorkOrder() {
    if (!workOrderFile) return
    try {
      if (navigator.canShare && navigator.canShare({ files: [workOrderFile] })) {
        await navigator.share({ files: [workOrderFile], title: `Work Order WO-${ticket.work_order_number}` })
      } else {
        // Fallback: download
        const url = URL.createObjectURL(workOrderFile)
        const a = document.createElement('a')
        a.href = url
        a.download = workOrderFile.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to share work order')
    }
  }

  function handleDownloadWorkOrder() {
    if (!workOrderFile) return
    const url = URL.createObjectURL(workOrderFile)
    const a = document.createElement('a')
    a.href = url
    a.download = workOrderFile.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  // Destructive status changes (force / reset) confirm through the shared
  // dialog instead of window.confirm(); the pending action is held here.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    action: () => void
  } | null>(null)

  async function handleDelete() {
    setDeleteConfirmOpen(false)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete ticket')
      }
      router.push('/tickets')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleReopen(targetStatus: string = 'in_progress') {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reopen ticket')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestSkip(payload: SkipRequestPayload) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'skip_requested',
          ...payload,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to request skip')
      }
      setSkipRequestOpen(false)
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleDenySkip() {
    const revertTo = ticket.skip_previous_status || 'assigned'
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: revertTo }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to deny skip request')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleForceStatus(targetStatus: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update status')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const confirmActionDialog = (
    <ConfirmDialog
      open={pendingConfirm !== null}
      title={pendingConfirm?.title ?? ''}
      message={pendingConfirm?.message ?? ''}
      confirmLabel={pendingConfirm?.confirmLabel}
      confirmVariant="danger"
      loading={loading}
      onConfirm={() => {
        pendingConfirm?.action()
        setPendingConfirm(null)
      }}
      onCancel={() => setPendingConfirm(null)}
    />
  )

  const superAdminOverride = userRole === 'super_admin' ? (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Super Admin: Force Status</p>
      <div className="flex flex-wrap gap-2">
        {forceTransitionsFor(ticket.status as TicketStatus).map((target) => (
          <button
            key={target}
            type="button"
            onClick={() =>
              setPendingConfirm({
                title: 'Force ticket status?',
                message: `Force ticket status to "${target.replace(/_/g, ' ')}"? This may clear completion data.`,
                confirmLabel: 'Force Status',
                action: () => handleForceStatus(target),
              })
            }
            disabled={loading}
            className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
          >
            → {target.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </div>
  ) : null

  const deleteButton = (userRole === 'super_admin' || userRole === 'manager') ? (
    <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setDeleteConfirmOpen(true)}
        disabled={loading}
        className="px-4 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Deleting...' : 'Delete PM Ticket'}
      </button>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this ticket?"
        message="The ticket will be moved to deleted. A manager can restore it from the deleted view; soft-deleted tickets may be purged after 30 days."
        confirmLabel="Delete"
        loading={loading}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  ) : null

  // ══════════════════════════════════════════════
  // Panel selection: one coordinator, five status panels (round 12 stage A
  // mechanical extraction: same status checks/order as before, JSX moved to
  // src/app/tickets/[id]/panels/*). All state/handlers above are unchanged;
  // only the render output moved.
  // ══════════════════════════════════════════════

  // Wraps setPendingConfirm + handleReopen the same way every inline
  // onClick={() => setPendingConfirm({ ..., action: () => handleReopen(x) })}
  // did before extraction (same title/message/confirmLabel/action per call site).
  function confirmReopen(opts: { title: string; message: string; confirmLabel: string; targetStatus: string }) {
    setPendingConfirm({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      action: () => handleReopen(opts.targetStatus),
    })
  }

  let panel: React.ReactNode

  if (ticket.status === 'unassigned' || ticket.status === 'assigned') {
    panel = (
      <UnassignedAssignedPanel
        error={error}
        loading={loading}
        onStart={handleStart}
        isTech={isTech}
        skipRequestOpen={skipRequestOpen}
        onOpenSkipRequest={() => setSkipRequestOpen(true)}
        onCancelSkipRequest={() => setSkipRequestOpen(false)}
        skipDefaultMonth={skipDefaultMonth}
        skipDefaultYear={skipDefaultYear}
        onSubmitSkipRequest={handleRequestSkip}
        superAdminOverride={superAdminOverride}
        deleteButton={deleteButton}
        confirmActionDialog={confirmActionDialog}
      />
    )
  }

  else if (ticket.status === 'in_progress') {
    panel = (
      <InProgressPanel
        error={error}
        equipmentToVerify={equipmentToVerify}
        ticketId={ticket.id}
        onEquipmentVerified={handleEquipmentVerified}
        handleComplete={handleComplete}
        completedDate={completedDate}
        setCompletedDate={setCompletedDate}
        hoursWorked={hoursWorked}
        setHoursWorked={setHoursWorked}
        machineHours={machineHours}
        setMachineHours={setMachineHours}
        dateCode={dateCode}
        setDateCode={setDateCode}
        pmParts={pmParts}
        setPmParts={setPmParts}
        pmDebounceRefs={pmDebounceRefs}
        pmComboRefs={pmComboRefs}
        isFlatRate={isFlatRate}
        flatRate={flatRate}
        additionalHoursWorked={additionalHoursWorked}
        setAdditionalHoursWorked={setAdditionalHoursWorked}
        additionalLaborTotal={additionalLaborTotal}
        laborRate={laborRate}
        isTech={isTech}
        tripChargeQty={tripChargeQty}
        setTripChargeQty={setTripChargeQty}
        tripChargeRate={tripChargeRate}
        tripChargeNum={tripChargeNum}
        additionalParts={additionalParts}
        setAdditionalParts={setAdditionalParts}
        addlDebounceRefs={addlDebounceRefs}
        addlComboRefs={addlComboRefs}
        additionalPartsTotal={additionalPartsTotal}
        additionalSubtotal={additionalSubtotal}
        grandTotal={grandTotal}
        completionNotes={completionNotes}
        setCompletionNotes={setCompletionNotes}
        aceLaborOpen={aceLaborOpen}
        setAceLaborOpen={setAceLaborOpen}
        aceHours={aceHours}
        setAceHours={setAceHours}
        aceReason={aceReason}
        setAceReason={setAceReason}
        billingContactName={billingContactName}
        setBillingContactName={setBillingContactName}
        billingContactEmail={billingContactEmail}
        setBillingContactEmail={setBillingContactEmail}
        billingContactPhone={billingContactPhone}
        setBillingContactPhone={setBillingContactPhone}
        photos={photos}
        onPhotoDelete={handlePhotoDelete}
        fileInputRef={fileInputRef}
        onPhotoUpload={handlePhotoUpload}
        uploading={uploading}
        onSignatureChange={({ image, name: sigName }) => { setSignatureImage(image); setSignatureName(sigName) }}
        onSaveProgress={handleSaveProgress}
        saving={saving}
        loading={loading}
        skipRequestOpen={skipRequestOpen}
        onOpenSkipRequest={() => setSkipRequestOpen(true)}
        onCancelSkipRequest={() => setSkipRequestOpen(false)}
        skipDefaultMonth={skipDefaultMonth}
        skipDefaultYear={skipDefaultYear}
        onSubmitSkipRequest={handleRequestSkip}
        saveSuccess={saveSuccess}
        localSavedVisible={localSavedVisible}
        userRole={userRole}
        onConfirmReopen={confirmReopen}
        superAdminOverride={superAdminOverride}
        deleteButton={deleteButton}
        confirmActionDialog={confirmActionDialog}
      />
    )
  }

  else if (ticket.status === 'skip_requested') {
    panel = (
      <SkipRequestedPanel
        ticket={ticket}
        isTech={isTech}
        error={error}
        loading={loading}
        skipDialogOpen={skipDialogOpen}
        onOpenSkipDialog={() => setSkipDialogOpen(true)}
        onCloseSkipDialog={() => setSkipDialogOpen(false)}
        onSkipDialogDone={() => { setSkipDialogOpen(false); router.push(pathname) }}
        onDenySkip={handleDenySkip}
        superAdminOverride={superAdminOverride}
        deleteButton={deleteButton}
        confirmActionDialog={confirmActionDialog}
      />
    )
  }

  else if (ticket.status === 'skipped') {
    panel = (
      <SkippedPanel
        isTech={isTech}
        error={error}
        loading={loading}
        onReopen={() => handleReopen('unassigned')}
        superAdminOverride={superAdminOverride}
        deleteButton={deleteButton}
        confirmActionDialog={confirmActionDialog}
      />
    )
  }

  else {
    // Completed or billed: read-only completion summary.
    panel = (
      <CompletedBilledPanel
        ticket={ticket}
        userRole={userRole}
        isTech={isTech}
        laborRate={laborRate}
        isFlatRate={isFlatRate}
        flatRate={flatRate}
        loading={loading}
        error={error}
        sharing={sharing}
        workOrderFile={workOrderFile}
        onPrepareWorkOrder={handlePrepareWorkOrder}
        onShareWorkOrder={handleShareWorkOrder}
        onDownloadWorkOrder={handleDownloadWorkOrder}
        onReopen={handleReopen}
        onConfirmReopen={confirmReopen}
        completed={completed}
        onViewWorkOrder={() => setCompleted(false)}
        superAdminOverride={superAdminOverride}
        deleteButton={deleteButton}
        confirmActionDialog={confirmActionDialog}
      />
    )
  }

  return (
    <>
      <TicketNextStepBar
        ticket={ticket}
        isTech={isTech}
        loading={loading}
        onStartWork={handleStart}
        onOpenSkipRequest={() => setSkipRequestOpen(true)}
      />
      {panel}
    </>
  )
}
