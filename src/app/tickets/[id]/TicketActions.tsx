'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TicketDetail } from '@/lib/db/tickets'
import { PartUsed, TicketPhoto, UserRole, TicketStatus } from '@/types/database'
import { VALID_TRANSITIONS } from '@/lib/ticket-transitions'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import { formatPhoneNumber } from '@/lib/phone'
import SignaturePad from '@/components/SignaturePad'
import ReadOnlyPhotos from '@/components/ReadOnlyPhotos'
import ConfirmDialog from '@/components/ConfirmDialog'
import SkipDialog from '../SkipDialog'
import SkipRequestForm, { SkipRequestPayload } from './SkipRequestForm'
import { renderPartsSection } from './renderPartsSection'
import { partLabel } from '@/lib/parts'
import { calcNextServiceMonth, formatMonthYear } from '@/lib/utils/schedule'
import { skipReasonLabel, isStopReason } from '@/lib/skip-reasons'

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

interface TicketActionsProps {
  ticket: TicketDetail
  userRole: UserRole | null
  userId: string | null
  laborRate: number
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

export default function TicketActions({ ticket, userRole, userId, laborRate }: TicketActionsProps) {
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

  // PM parts: from saved data or from equipment defaults
  const defaultProducts = ticket.equipment?.default_products ?? []
  const [pmParts, setPmParts] = useState<PartEntry[]>(
    ticket.parts_used && ticket.parts_used.length > 0
      ? partsFromSaved(ticket.parts_used)
      : partsFromDefaults(defaultProducts)
  )

  // Additional work state
  const [additionalParts, setAdditionalParts] = useState<PartEntry[]>(
    ticket.additional_parts_used && ticket.additional_parts_used.length > 0
      ? partsFromSaved(ticket.additional_parts_used)
      : []
  )
  const [additionalHoursWorked, setAdditionalHoursWorked] = useState(
    ticket.additional_hours_worked != null ? String(ticket.additional_hours_worked) : ''
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
  const [poNumber, setPoNumber] = useState(ticket.po_number ?? '')
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
  const grandTotal = pmSubtotal + additionalSubtotal

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

    const pendingParts = (ticket.parts_requested ?? []).filter(
      (p: { status: string }) => p.status !== 'received'
    )
    if (pendingParts.length > 0) {
      setError(`Cannot complete: ${pendingParts.length} part(s) are not yet received.`)
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
          completionNotes,
          billingAmount: grandTotal,
          customerSignature: signatureImage,
          customerSignatureName: signatureName.trim(),
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          poNumber: poNumber || undefined,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function saveProgress(opts?: { keepalive?: boolean }) {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: opts?.keepalive ?? false,
        body: JSON.stringify({
          completed_date: completedDate || null,
          hours_worked: parseFloat(hoursWorked) || null,
          completion_notes: completionNotes || null,
          parts_used: pmParts.length > 0 ? toPartUsed(pmParts) : null,
          additional_parts_used: additionalParts.length > 0 ? toPartUsed(additionalParts) : [],
          additional_hours_worked: parseFloat(additionalHoursWorked) || null,
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          po_number: poNumber || null,
          billing_contact_name: billingContactName || null,
          billing_contact_email: billingContactEmail || null,
          billing_contact_phone: billingContactPhone || null,
          machine_hours: parseFloat(machineHours) || null,
          date_code: dateCode.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save progress')
      }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
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
  }, [completedDate, hoursWorked, machineHours, dateCode, completionNotes, pmParts, additionalParts, additionalHoursWorked, poNumber, billingContactName, billingContactEmail, billingContactPhone, photos])

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

  const superAdminOverride = userRole === 'super_admin' ? (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Super Admin: Force Status</p>
      <div className="flex flex-wrap gap-2">
        {forceTransitionsFor(ticket.status as TicketStatus).map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => {
              if (confirm(`Force ticket status to "${target.replace(/_/g, ' ')}"? This may clear completion data.`)) {
                handleForceStatus(target)
              }
            }}
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
        {loading ? 'Deleting...' : 'Delete Ticket'}
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
  // RENDER: Unassigned or Assigned
  // ══════════════════════════════════════════════

  if (ticket.status === 'unassigned' || ticket.status === 'assigned') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Actions
        </h2>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Starting...' : 'Start Work'}
          </button>
          {isTech && (
            <button
              type="button"
              onClick={() => setSkipRequestOpen(true)}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              Request Skip
            </button>
          )}
        </div>
        {skipRequestOpen && isTech && (
          <SkipRequestForm
            defaultMonth={skipDefaultMonth}
            defaultYear={skipDefaultYear}
            loading={loading}
            onSubmit={handleRequestSkip}
            onCancel={() => setSkipRequestOpen(false)}
          />
        )}
        {superAdminOverride}
        {deleteButton}
      </div>
    )
  }

  // ══════════════════════════════════════════════
  // RENDER: In Progress — Completion Form
  // ══════════════════════════════════════════════

  if (ticket.status === 'in_progress') {
    return (
      <>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
            Complete Ticket
          </h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <form onSubmit={handleComplete} className="space-y-5 max-w-xl">
            {/* Date + PO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="completedDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Completion Date
                </label>
                <input
                  id="completedDate"
                  type="date"
                  required
                  value={completedDate}
                  onChange={(e) => setCompletedDate(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  PO Number
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="Enter PO number if required..."
                />
              </div>
            </div>

            <div>
              <label htmlFor="hoursWorked" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Hours Worked
              </label>
              <input
                id="hoursWorked"
                type="number"
                step="0.25"
                min="0"
                required
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="0.00"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="machineHours" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Machine Hours <span className="text-red-500">*</span>
                </label>
                <input
                  id="machineHours"
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  value={machineHours}
                  onChange={(e) => setMachineHours(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="e.g. 1247.5"
                />
              </div>
              <div>
                <label htmlFor="dateCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date Code <span className="text-red-500">*</span>
                </label>
                <input
                  id="dateCode"
                  type="text"
                  required
                  value={dateCode}
                  onChange={(e) => setDateCode(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="e.g. 26W15"
                />
              </div>
            </div>

            {/* ── SECTION 1: PM Service ── */}
            <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-4">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide mb-1">
                PM Service — Covered Under Agreement
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Parts included in the PM agreement</p>

              {renderPartsSection({
                parts: pmParts,
                setter: setPmParts,
                debounceMap: pmDebounceRefs,
                comboMap: pmComboRefs,
                options: { showPrices: false, zeroPricesOnSelect: true, keyPrefix: 'pm' },
              })}

              {/* PM Subtotal */}
              {isFlatRate && (
                <div className="flex items-center justify-between mt-3 py-2 px-3 bg-blue-100 dark:bg-blue-900/30 rounded-md">
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-300">PM Service — Flat Rate</span>
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">${flatRate!.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* ── SECTION 2: Additional Work ── */}
            <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-4">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-1">
                Additional Work — Not Covered Under Agreement
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Labor and parts beyond the PM agreement</p>

              {/* Additional Labor Hours */}
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Additional Labor Hours
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={additionalHoursWorked}
                    onChange={(e) => setAdditionalHoursWorked(e.target.value)}
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-24 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="0.00"
                  />
                  {parseFloat(additionalHoursWorked) > 0 && (
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      @ ${laborRate.toFixed(2)}/hr = <strong>${additionalLaborTotal.toFixed(2)}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Additional Parts */}
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Additional Parts
              </label>
              {renderPartsSection({
                parts: additionalParts,
                setter: setAdditionalParts,
                debounceMap: addlDebounceRefs,
                comboMap: addlComboRefs,
                options: { showPrices: true, zeroPricesOnSelect: false, keyPrefix: 'addl' },
              })}

              {/* Additional Work Subtotal */}
              {(additionalPartsTotal > 0 || additionalLaborTotal > 0) && (
                <div className="mt-3 py-2 px-3 bg-amber-100 dark:bg-amber-900/30 rounded-md space-y-1">
                  {additionalLaborTotal > 0 && (
                    <div className="flex justify-between text-sm text-amber-900 dark:text-amber-300">
                      <span>Labor: {additionalHoursWorked} hrs × ${laborRate.toFixed(2)}</span>
                      <span>${additionalLaborTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {additionalPartsTotal > 0 && (
                    <div className="flex justify-between text-sm text-amber-900 dark:text-amber-300">
                      <span>Parts</span>
                      <span>${additionalPartsTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold text-amber-900 dark:text-amber-300 pt-1 border-t border-amber-200 dark:border-amber-800">
                    <span>Additional Work Subtotal</span>
                    <span>${additionalSubtotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── GRAND TOTAL ── */}
            <div className="rounded-lg bg-gray-900 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  {isFlatRate && `PM: $${pmSubtotal.toFixed(2)}`}
                  {isFlatRate && additionalSubtotal > 0 && ' + '}
                  {additionalSubtotal > 0 && `Additional: $${additionalSubtotal.toFixed(2)}`}
                </div>
                <span className="text-base font-bold text-white">Grand Total</span>
              </div>
              <span className="text-lg font-bold text-white">${grandTotal.toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-3 text-right">Taxes not included</p>

            {/* Completion Notes */}
            <div>
              <label htmlFor="completionNotes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Completion Notes
              </label>
              <textarea
                id="completionNotes"
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="Notes about the work performed..."
              />
            </div>

            {/* ── ACE Labor (tech payout — not on customer invoice) ── */}
            <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/15 p-4">
              {!aceLaborOpen ? (
                <button
                  type="button"
                  onClick={() => setAceLaborOpen(true)}
                  aria-expanded={false}
                  className="text-sm font-medium text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-200"
                >
                  + Add ACE Labor
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-purple-800 dark:text-purple-300 uppercase tracking-wide">
                      ACE Labor — Pending Manager Approval
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setAceLaborOpen(false); setAceHours(''); setAceReason('') }}
                      className="text-xs text-purple-700 dark:text-purple-300 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Tech-payout labor on no-charge work. Does not appear on the customer invoice.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="aceHours" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        ACE Hours
                      </label>
                      <input
                        id="aceHours"
                        type="number"
                        step="0.25"
                        min="0"
                        value={aceHours}
                        onChange={(e) => setAceHours(e.target.value)}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-32 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="aceReason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reason
                      </label>
                      <textarea
                        id="aceReason"
                        value={aceReason}
                        onChange={(e) => setAceReason(e.target.value)}
                        rows={2}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="Why this is ACE-eligible (visible to your manager)..."
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Billing Contact */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Billing Contact
              </label>
              <div className="space-y-2">
                <input
                  type="text"
                  value={billingContactName}
                  onChange={(e) => setBillingContactName(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="Name"
                />
                <input
                  type="email"
                  value={billingContactEmail}
                  onChange={(e) => setBillingContactEmail(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="Email"
                />
                <input
                  type="tel"
                  value={billingContactPhone}
                  onChange={(e) => setBillingContactPhone(formatPhoneNumber(e.target.value))}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="(205) 555-1234"
                />
              </div>
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Service Photos
              </label>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {photos.map((photo, i) => (
                    <div key={photo.storage_path} className="relative aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700">
                      {photo.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.previewUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">Loading...</div>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePhotoDelete(i)}
                        className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center bg-black/60 text-white rounded-full text-sm hover:bg-black/80 min-h-[44px] min-w-[44px] -mt-2 -mr-2 p-0"
                        style={{ minHeight: 44, minWidth: 44, marginTop: -10, marginRight: -10 }}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {uploading ? 'Uploading...' : '+ Add Photo'}
              </button>
            </div>

            <SignaturePad
              onSignatureChange={({ image, name: sigName }) => {
                setSignatureImage(image)
                setSignatureName(sigName)
              }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveProgress}
                disabled={saving || loading || uploading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {saving ? 'Saving...' : 'Save Progress'}
              </button>
              <button
                type="submit"
                disabled={loading || saving || uploading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {loading ? 'Completing...' : 'Mark Complete'}
              </button>
              {isTech && (
                <button
                  type="button"
                  onClick={() => setSkipRequestOpen(true)}
                  disabled={loading || saving}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  Request Skip
                </button>
              )}
              {saveSuccess && (
                <span className="text-sm text-green-600">Saved</span>
              )}
            </div>

            {/* Skip request form — tech only, in_progress */}
            {skipRequestOpen && isTech && (
              <SkipRequestForm
                defaultMonth={skipDefaultMonth}
                defaultYear={skipDefaultYear}
                loading={loading}
                onSubmit={handleRequestSkip}
                onCancel={() => setSkipRequestOpen(false)}
              />
            )}
          </form>
          {(userRole === 'super_admin' || userRole === 'manager') && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Manager: Reset ticket status</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { if (confirm('Reset this ticket to Assigned? Draft work will be cleared.')) handleReopen('assigned') }}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
                >
                  Reset to Assigned
                </button>
                <button
                  type="button"
                  onClick={() => { if (confirm('Reset this ticket to Unassigned? Draft work and technician assignment will be cleared.')) handleReopen('unassigned') }}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
                >
                  Reset to Unassigned
                </button>
              </div>
            </div>
          )}
          {superAdminOverride}
        </div>
        {deleteButton}
      </>
    )
  }

  // ══════════════════════════════════════════════
  // RENDER: Skip Requested — Pending Approval
  // ══════════════════════════════════════════════

  if (ticket.status === 'skip_requested') {
    return (
      <>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-4">
            Skip Requested
          </h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          {/* Structured skip request (legacy rows show only the free-text reason) */}
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-md p-3 mb-4 border border-amber-200 dark:border-amber-800 space-y-2">
            {ticket.skip_reason_category ? (
              <>
                <div>
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Reason</p>
                  <p className="text-sm text-gray-900 dark:text-white">{skipReasonLabel(ticket.skip_reason_category)}</p>
                </div>
                {ticket.skip_equipment_on_site !== null && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Equipment still on site</p>
                    <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_equipment_on_site ? 'Yes' : 'No'}</p>
                  </div>
                )}
                {ticket.skip_recommended_month && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Customer&apos;s requested next PM</p>
                    <p className="text-sm text-gray-900 dark:text-white">{formatMonthYear(ticket.skip_recommended_month, ticket.skip_recommended_year)}</p>
                  </div>
                )}
                {ticket.skip_reason && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Notes</p>
                    <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_reason}</p>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Reason</p>
                <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_reason || '—'}</p>
              </div>
            )}
          </div>

          {isTech ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your skip request has been submitted and is waiting for manager approval.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSkipDialogOpen(true)}
                disabled={loading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Approve Skip
              </button>
              <button
                onClick={handleDenySkip}
                disabled={loading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {loading ? 'Denying...' : 'Deny Skip'}
              </button>
            </div>
          )}
          {superAdminOverride}
          {deleteButton}
        </div>

        {skipDialogOpen && (
          <SkipDialog
            tickets={[{
              id: ticket.id,
              month: ticket.month,
              year: ticket.year,
              work_order_number: ticket.work_order_number,
              customers: ticket.customers ? { name: ticket.customers.name } : null,
              equipment: ticket.equipment
                ? { make: ticket.equipment.make, model: ticket.equipment.model }
                : null,
              // TicketDetail exposes the schedule join as `schedule` (different
              // shape than the listing's `pm_schedules`); SkipDialog needs the
              // listing shape so we map it explicitly.
              pm_schedules: ticket.schedule
                ? { interval_months: ticket.schedule.interval_months, anchor_month: ticket.schedule.anchor_month }
                : null,
            }]}
            recommendedMonth={ticket.skip_recommended_month ?? undefined}
            recommendedYear={ticket.skip_recommended_year ?? undefined}
            suggestStop={isStopReason(ticket.skip_reason_category) || ticket.skip_equipment_on_site === false}
            onClose={() => setSkipDialogOpen(false)}
            onDone={() => {
              setSkipDialogOpen(false)
              router.push(pathname)
            }}
          />
        )}
      </>
    )
  }

  // ══════════════════════════════════════════════
  // RENDER: Skipped
  // ══════════════════════════════════════════════

  if (ticket.status === 'skipped') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Ticket Skipped
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">This ticket was skipped and no work was performed.</p>
        {!isTech && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <button
              onClick={() => handleReopen('unassigned')}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Reopening...' : 'Reopen Ticket'}
            </button>
          </div>
        )}
        {superAdminOverride}
        {deleteButton}
      </div>
    )
  }

  // ══════════════════════════════════════════════
  // RENDER: Completed or Billed — Read-Only
  // ══════════════════════════════════════════════

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        Completion Details
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm mb-4">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Completed Date</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.completed_date
              ? new Date(ticket.completed_date).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Hours Worked</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.hours_worked ?? '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Billing Amount</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.billing_amount != null
              ? `$${ticket.billing_amount.toFixed(2)}`
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Billing Exported</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.billing_exported ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      {/* PM Service Section (read-only) */}
      {ticket.parts_used && ticket.parts_used.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-3 mb-3">
          <h3 className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide mb-2">
            PM Service — Covered Under Agreement
          </h3>
          <div className="space-y-1">
            {ticket.parts_used.map((part, i) => (
              <div key={`ro-pm-${i}`} className="text-sm text-gray-900 dark:text-white">
                {partLabel(part)} — Qty: {part.quantity}
              </div>
            ))}
          </div>
          {isFlatRate && flatRate != null && (
            <div className="flex justify-between mt-2 pt-2 border-t border-blue-200 dark:border-blue-800 text-sm font-semibold text-blue-800 dark:text-blue-300">
              <span>PM Service — Flat Rate</span>
              <span>${flatRate.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Additional Work Section (read-only) */}
      {((ticket.additional_parts_used && ticket.additional_parts_used.length > 0) || (ticket.additional_hours_worked && ticket.additional_hours_worked > 0)) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-3 mb-3">
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">
            Additional Work — Not Covered Under Agreement
          </h3>
          {ticket.additional_hours_worked != null && ticket.additional_hours_worked > 0 && (
            <div className="text-sm text-gray-900 dark:text-white mb-1">
              Additional Labor: {ticket.additional_hours_worked} hrs
              {` @ $${laborRate.toFixed(2)}/hr = $${(ticket.additional_hours_worked * laborRate).toFixed(2)}`}
            </div>
          )}
          {ticket.additional_parts_used && ticket.additional_parts_used.length > 0 && (
            <div className="space-y-1">
              {ticket.additional_parts_used.map((part, i) => (
                <div key={`ro-addl-${i}`} className="text-sm text-gray-900 dark:text-white">
                  {partLabel(part)} — Qty: {part.quantity}
                  {` @ $${part.unit_price.toFixed(2)} = $${(part.quantity * part.unit_price).toFixed(2)}`}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <span>Additional Work Subtotal</span>
            <span>
              ${(
                ((ticket.additional_hours_worked ?? 0) * laborRate) +
                (ticket.additional_parts_used ?? []).reduce((s, p) => s + p.quantity * p.unit_price, 0)
              ).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Grand Total (read-only) */}
      {ticket.billing_amount != null && (
        <div className="rounded-lg bg-gray-900 px-4 py-3 flex items-center justify-between mb-1">
          <span className="text-base font-bold text-white">Grand Total</span>
          <span className="text-lg font-bold text-white">${ticket.billing_amount.toFixed(2)}</span>
        </div>
      )}
      {ticket.billing_amount != null && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right mb-3">Taxes not included</p>
      )}

      {ticket.completion_notes && (
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Notes</span>
          <p className="text-sm text-gray-900 dark:text-white mt-1 whitespace-pre-wrap">
            {ticket.completion_notes}
          </p>
        </div>
      )}
      {ticket.photos && ticket.photos.length > 0 && (
        <ReadOnlyPhotos photos={ticket.photos} />
      )}
      {ticket.customer_signature && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">Customer Signature</span>
          <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 p-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ticket.customer_signature}
              alt="Customer signature"
              className="h-20 w-auto"
            />
          </div>
          {ticket.customer_signature_name && (
            <p className="text-sm text-gray-900 dark:text-white font-medium mt-1">
              {ticket.customer_signature_name}
            </p>
          )}
        </div>
      )}
      {/* Share Work Order — visible to all roles on completed/billed tickets */}
      <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
        {!workOrderFile ? (
          <button
            onClick={handlePrepareWorkOrder}
            disabled={sharing}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {sharing ? 'Generating...' : 'Share Work Order'}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleShareWorkOrder}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px]"
            >
              Share
            </button>
            <button
              onClick={handleDownloadWorkOrder}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
            >
              Download
            </button>
            <span className="text-sm text-green-600">Ready</span>
          </div>
        )}
      </div>
      {ticket.status === 'completed' && !isTech && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={() => handleReopen('in_progress')}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Reopening...' : 'Reopen Ticket'}
          </button>
        </div>
      )}
      {ticket.status === 'billed' && (userRole === 'super_admin' || userRole === 'manager') && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Manager: Reset ticket status</p>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { if (confirm('Move back to Completed? Billing export flag will be cleared.')) handleReopen('completed') }}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Back to Completed
            </button>
            <button
              onClick={() => { if (confirm('Reset to In Progress? All completion data will be cleared.')) handleReopen('in_progress') }}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Back to In Progress
            </button>
            <button
              onClick={() => { if (confirm('Reset to Assigned? All completion data will be cleared.')) handleReopen('assigned') }}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Back to Assigned
            </button>
            <button
              onClick={() => { if (confirm('Reset to Unassigned? All data including technician assignment will be cleared.')) handleReopen('unassigned') }}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Back to Unassigned
            </button>
          </div>
        </div>
      )}
      {superAdminOverride}
      {deleteButton}
    </div>
  )
}
