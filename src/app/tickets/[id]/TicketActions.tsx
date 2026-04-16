'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TicketDetail } from '@/lib/db/tickets'
import { PartUsed, TicketPhoto, UserRole } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import SignaturePad from '@/components/SignaturePad'
import SkipDialog from '../SkipDialog'

interface ProductResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
}

interface PartEntry {
  description: string
  quantity: number
  unitPrice: number
  synergyProductId: number | null
  isFromDb: boolean
  searchOpen: boolean
  searchResults: ProductResult[]
  searching: boolean
}

interface TicketActionsProps {
  ticket: TicketDetail
  userRole: UserRole | null
  userId: string | null
  laborRate: number
}

function ReadOnlyPhotos({ photos }: { photos: TicketPhoto[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const supabase = createClient()
    Promise.all(
      photos.map(async (p) => {
        const { data } = await supabase.storage
          .from('ticket-photos')
          .createSignedUrl(p.storage_path, 3600)
        return data?.signedUrl ?? ''
      })
    ).then(setUrls)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (urls.length === 0 && photos.length > 0) return null

  return (
    <div className="mt-4">
      <span className="text-sm text-gray-500 dark:text-gray-400">Service Photos</span>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {urls.map((url, i) => (
          url ? (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Service photo ${i + 1}`} className="w-full h-full object-cover" />
            </a>
          ) : null
        ))}
      </div>
    </div>
  )
}

function emptyPart(): PartEntry {
  return {
    description: '',
    quantity: 1,
    unitPrice: 0,
    synergyProductId: null,
    isFromDb: false,
    searchOpen: false,
    searchResults: [],
    searching: false,
  }
}

function partsFromSaved(saved: PartUsed[]): PartEntry[] {
  return saved.map((p) => ({
    description: p.description,
    quantity: p.quantity,
    unitPrice: p.unit_price,
    synergyProductId: p.synergy_product_id,
    isFromDb: p.synergy_product_id != null,
    searchOpen: false,
    searchResults: [],
    searching: false,
  }))
}

function partsFromDefaults(defaults: { synergy_product_id: number; quantity: number; description: string }[]): PartEntry[] {
  return defaults.map((d) => ({
    description: d.description,
    quantity: d.quantity,
    unitPrice: 0,
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
    quantity: p.quantity,
    unit_price: p.unitPrice,
  }))
}

const FORCE_TRANSITIONS: Record<string, string[]> = {
  unassigned: ['assigned', 'in_progress', 'skipped'],
  assigned:   ['in_progress', 'unassigned', 'skipped', 'skip_requested'],
  in_progress: ['assigned', 'unassigned', 'skip_requested'],
  completed:  ['billed', 'in_progress'],
  billed:     ['completed', 'in_progress', 'assigned', 'unassigned'],
  skipped:    ['unassigned'],
  skip_requested: ['skipped', 'in_progress', 'assigned'],
}

export default function TicketActions({ ticket, userRole, userId, laborRate }: TicketActionsProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'
  const canSeePricing = userRole === 'super_admin' || userRole === 'manager' || userRole === 'coordinator'

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
  const [skipReason, setSkipReason] = useState('')
  const [skipDialogOpen, setSkipDialogOpen] = useState(false)

  // Photo state
  const [photos, setPhotos] = useState<Array<TicketPhoto & { previewUrl?: string }>>(
    ticket.photos && ticket.photos.length > 0 ? ticket.photos : []
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-save debounce
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)

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

  // ── Product search helpers (parameterized by section) ──

  function handlePartSearch(
    index: number,
    value: string,
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
    debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>
  ) {
    setter((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], description: value, isFromDb: false, synergyProductId: null }
      return updated
    })

    const existing = debounceMap.current.get(index)
    if (existing) clearTimeout(existing)

    if (!value.trim()) {
      setter((prev) => {
        const updated = [...prev]
        if (updated[index]) {
          updated[index] = { ...updated[index], searchOpen: false, searchResults: [] }
        }
        return updated
      })
      return
    }

    debounceMap.current.set(index, setTimeout(async () => {
      setter((prev) => {
        const u = [...prev]
        if (u[index]) u[index] = { ...u[index], searching: true }
        return u
      })

      const supabase = createClient()
      const q = value.trim()
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description, unit_price')
        .or(`number.ilike.%${q}%,description.ilike.%${q}%`)
        .order('number')
        .limit(25)

      setter((prev) => {
        const u = [...prev]
        if (u[index]) {
          u[index] = {
            ...u[index],
            searchResults: (data as ProductResult[]) ?? [],
            searchOpen: true,
            searching: false,
          }
        }
        return u
      })
    }, 300))
  }

  function handleSelectProduct(
    index: number,
    product: ProductResult,
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
    zeroPrices: boolean
  ) {
    setter((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        description: `${product.number} - ${product.description ?? ''}`,
        unitPrice: zeroPrices ? 0 : (product.unit_price ?? 0),
        synergyProductId: Number(product.synergy_id),
        isFromDb: true,
        searchOpen: false,
        searchResults: [],
      }
      return updated
    })
  }

  function handleClearProduct(
    index: number,
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>
  ) {
    setter((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], description: '', unitPrice: 0, synergyProductId: null, isFromDb: false }
      return updated
    })
  }

  function handleUpdatePartField(
    index: number,
    field: 'quantity' | 'unitPrice',
    value: string | number,
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>
  ) {
    setter((prev) => {
      const updated = [...prev]
      if (field === 'quantity') {
        updated[index] = { ...updated[index], quantity: Number(value) }
      } else {
        updated[index] = { ...updated[index], unitPrice: Number(value) }
      }
      return updated
    })
  }

  function handleRemovePart(
    index: number,
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
    debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>,
    comboMap: React.MutableRefObject<Map<number, HTMLDivElement | null>>
  ) {
    setter((prev) => prev.filter((_, i) => i !== index))
    debounceMap.current.delete(index)
    comboMap.current.delete(index)
  }

  // ── Computed totals ──

  const additionalPartsTotal = additionalParts.reduce(
    (sum, p) => sum + p.quantity * p.unitPrice, 0
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
          billingAmount: canSeePricing ? grandTotal : 0,
          customerSignature: signatureImage,
          customerSignatureName: signatureName.trim(),
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          poNumber: poNumber || undefined,
          billingContactName: billingContactName || undefined,
          billingContactEmail: billingContactEmail || undefined,
          billingContactPhone: billingContactPhone || undefined,
          machineHours: parseFloat(machineHours),
          dateCode: dateCode.trim(),
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

  async function saveProgress() {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  }, [completedDate, hoursWorked, completionNotes, pmParts, additionalParts, additionalHoursWorked, poNumber, billingContactName, billingContactEmail, billingContactPhone, photos])

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
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

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

  async function handleDelete() {
    if (!confirm('Permanently delete this ticket? This cannot be undone.')) return
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

  async function handleRequestSkip() {
    if (!skipReason.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'skip_requested',
          skip_reason: skipReason.trim(),
          skip_previous_status: ticket.status,
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
        {(FORCE_TRANSITIONS[ticket.status] ?? []).map((target) => (
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
        onClick={handleDelete}
        disabled={loading}
        className="px-4 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Deleting...' : 'Delete Ticket'}
      </button>
    </div>
  ) : null

  // ── Reusable parts list renderer ──

  function renderPartsSection(
    parts: PartEntry[],
    setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
    debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>,
    comboMap: React.MutableRefObject<Map<number, HTMLDivElement | null>>,
    options: { showPrices: boolean; zeroPricesOnSelect: boolean; keyPrefix: string }
  ) {
    return (
      <>
        {parts.length > 0 && (
          <div className="space-y-2">
            {parts.map((part, i) => (
              <div key={`${options.keyPrefix}-${i}`} className="rounded-md border border-gray-200 p-3 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:grid sm:items-center sm:gap-2" style={{ gridTemplateColumns: options.showPrices ? '1fr 56px 72px 72px auto' : '1fr 56px auto' }}>
                {/* Description with product search */}
                <div
                  className="relative min-w-0"
                  ref={(el) => { comboMap.current.set(i, el) }}
                >
                  {part.isFromDb ? (
                    <div className="flex items-center gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 dark:text-white">
                      <span className="flex-1 truncate">{part.description}</span>
                      <button
                        type="button"
                        onClick={() => handleClearProduct(i, setter)}
                        className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0 p-1"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Search products..."
                      value={part.description}
                      onChange={(e) => handlePartSearch(i, e.target.value, setter, debounceMap)}
                      className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  )}
                  {part.searchOpen && part.searchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {part.searchResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => handleSelectProduct(i, product, setter, options.zeroPricesOnSelect)}
                          className="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                        >
                          <span className="font-medium text-gray-900 dark:text-white">{product.number}</span>
                          <span className="text-gray-500 dark:text-gray-400"> — {product.description ?? ''}</span>
                          {options.showPrices && product.unit_price != null && (
                            <span className="text-green-700 dark:text-green-400 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">
                              ${product.unit_price.toFixed(2)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {part.searchOpen && !part.searching && part.searchResults.length === 0 && part.description.trim() && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                      No products found — enter details manually
                    </div>
                  )}
                  {part.searching && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                      Searching...
                    </div>
                  )}
                </div>
                {/* Qty + optional Price + Remove */}
                <div className="flex items-center gap-2 sm:contents">
                  <div className="flex-1 sm:contents">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5 sm:hidden">Qty</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={part.quantity}
                      onChange={(e) => handleUpdatePartField(i, 'quantity', e.target.value, setter)}
                      className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-2 h-[44px] sm:h-[34px] text-sm text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                  {options.showPrices && (
                    <>
                      <div className="flex-1 sm:contents">
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5 sm:hidden">Price</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Price"
                          value={part.unitPrice}
                          onChange={(e) => handleUpdatePartField(i, 'unitPrice', e.target.value, setter)}
                          readOnly={part.isFromDb}
                          className={`w-full rounded-md border px-2 h-[44px] sm:h-[34px] text-sm text-gray-900 dark:text-white text-right focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                            part.isFromDb ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 cursor-not-allowed' : 'border-gray-300 dark:bg-gray-700 dark:border-gray-600'
                          }`}
                        />
                      </div>
                      <div className="hidden sm:block text-sm text-gray-600 dark:text-gray-400 text-right tabular-nums">
                        ${(part.quantity * part.unitPrice).toFixed(2)}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemovePart(i, setter, debounceMap, comboMap)}
                    className="text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs min-h-[44px] sm:min-h-0 flex items-center justify-center px-1"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setter((prev) => [...prev, emptyPart()])}
          className="text-sm font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white py-2 min-h-[44px] sm:min-h-0 flex items-center"
        >
          + Add Part
        </button>
      </>
    )
  }

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
        {skipRequestOpen && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Why should this PM be skipped?
            </label>
            <textarea
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder="e.g., Customer requested to reschedule, machine is down..."
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRequestSkip}
                disabled={loading || !skipReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Submitting...' : 'Submit Skip Request'}
              </button>
              <button
                type="button"
                onClick={() => { setSkipRequestOpen(false); setSkipReason('') }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Completion Date
                </label>
                <input
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Hours Worked
              </label>
              <input
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Machine Hours <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  value={machineHours}
                  onChange={(e) => setMachineHours(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="e.g. 1247.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={dateCode}
                  onChange={(e) => setDateCode(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
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

              {renderPartsSection(
                pmParts, setPmParts, pmDebounceRefs, pmComboRefs,
                { showPrices: false, zeroPricesOnSelect: true, keyPrefix: 'pm' }
              )}

              {/* PM Subtotal — managers/coordinators only */}
              {canSeePricing && isFlatRate && (
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
              {renderPartsSection(
                additionalParts, setAdditionalParts, addlDebounceRefs, addlComboRefs,
                { showPrices: true, zeroPricesOnSelect: false, keyPrefix: 'addl' }
              )}

              {/* Additional Work Subtotal — managers/coordinators only */}
              {canSeePricing && (additionalPartsTotal > 0 || additionalLaborTotal > 0) && (
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

            {/* ── GRAND TOTAL — managers/coordinators only ── */}
            {canSeePricing && (
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
            )}
            {canSeePricing && (
              <p className="text-xs text-gray-400 dark:text-gray-500 -mt-3 text-right">Taxes not included</p>
            )}

            {/* Completion Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Completion Notes
              </label>
              <textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="Notes about the work performed..."
              />
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
                  onChange={(e) => setBillingContactPhone(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="Phone"
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
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Why should this PM be skipped?
                </label>
                <textarea
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="e.g., Customer requested to reschedule, machine is down..."
                  rows={3}
                  className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRequestSkip}
                    disabled={loading || !skipReason.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Submitting...' : 'Submit Skip Request'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSkipRequestOpen(false); setSkipReason('') }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
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

          {/* Show the reason */}
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-md p-3 mb-4 border border-amber-200 dark:border-amber-800">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Reason</p>
            <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_reason || '—'}</p>
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
            tickets={[ticket as any]}
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
        {canSeePricing && (
          <>
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
          </>
        )}
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
                {part.description} — Qty: {part.quantity}
              </div>
            ))}
          </div>
          {canSeePricing && isFlatRate && flatRate != null && (
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
              {canSeePricing && ` @ $${laborRate.toFixed(2)}/hr = $${(ticket.additional_hours_worked * laborRate).toFixed(2)}`}
            </div>
          )}
          {ticket.additional_parts_used && ticket.additional_parts_used.length > 0 && (
            <div className="space-y-1">
              {ticket.additional_parts_used.map((part, i) => (
                <div key={`ro-addl-${i}`} className="text-sm text-gray-900 dark:text-white">
                  {part.description} — Qty: {part.quantity}
                  {canSeePricing && ` @ $${part.unit_price.toFixed(2)} = $${(part.quantity * part.unit_price).toFixed(2)}`}
                </div>
              ))}
            </div>
          )}
          {canSeePricing && (
            <div className="flex justify-between mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 text-sm font-semibold text-amber-900 dark:text-amber-300">
              <span>Additional Work Subtotal</span>
              <span>
                ${(
                  ((ticket.additional_hours_worked ?? 0) * laborRate) +
                  (ticket.additional_parts_used ?? []).reduce((s, p) => s + p.quantity * p.unit_price, 0)
                ).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Grand Total (read-only) */}
      {canSeePricing && ticket.billing_amount != null && (
        <div className="rounded-lg bg-gray-900 px-4 py-3 flex items-center justify-between mb-1">
          <span className="text-base font-bold text-white">Grand Total</span>
          <span className="text-lg font-bold text-white">${ticket.billing_amount.toFixed(2)}</span>
        </div>
      )}
      {canSeePricing && ticket.billing_amount != null && (
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
