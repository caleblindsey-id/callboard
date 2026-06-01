'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { X, Camera } from 'lucide-react'
import type { EquipmentSaleTier, TechLeadFrequency, TechLeadType, TicketPhoto } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import { EQUIPMENT_SALE_TIER_LIST } from '@/lib/tech-leads/bonus-tiers'
import { compressImage } from '@/lib/image-utils'
import DraftRestoredToast from '@/components/DraftRestoredToast'
import { useFormDraft } from '@/lib/hooks/useFormDraft'

const DRAFT_KEY = 'draft-submit-lead'

// Photos (Blob + object URLs) can't be JSON.stringify'd — they're skipped from
// the persisted draft. The user is notified via the toast `note`.
interface SubmitLeadDraft {
  leadType: TechLeadType
  customerSearch: string
  customerId: number | null
  newCustomerMode: boolean
  newCustomerName: string
  make: string
  model: string
  serialNumber: string
  locationOnSite: string
  startMonth: number
  startYear: number
  frequency: TechLeadFrequency | ''
  equipmentTier: EquipmentSaleTier | ''
  contactName: string
  contactEmail: string
  contactPhone: string
  notes: string
}

const MAX_PHOTOS = 12

type PendingPhoto = {
  id: string
  blob: Blob
  previewUrl: string
}

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
}

interface SubmitLeadModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal edits this existing (pending) lead instead of creating one. */
  lead?: TechLeadWithJoins | null
}

const FREQUENCIES: { value: TechLeadFrequency; label: string; eligible: boolean }[] = [
  { value: 'monthly', label: 'Monthly', eligible: true },
  { value: 'bi-monthly', label: 'Bi-monthly', eligible: true },
  { value: 'quarterly', label: 'Quarterly', eligible: true },
  { value: 'semi-annual', label: 'Semi-annual', eligible: false },
  { value: 'annual', label: 'Annual', eligible: false },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function SubmitLeadModal({ open, onClose, lead = null }: SubmitLeadModalProps) {
  const router = useRouter()
  const isEdit = lead !== null
  const existingPhotoCount = (lead?.photos as TicketPhoto[] | null)?.length ?? 0

  // Lead type toggle (new in V2)
  const [leadType, setLeadType] = useState<TechLeadType>('pm')

  // Customer selection
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [newCustomerMode, setNewCustomerMode] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const comboRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // PM lead fields — structured equipment (072+).
  const now = new Date()
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [locationOnSite, setLocationOnSite] = useState('')
  const [startMonth, setStartMonth] = useState<number>(now.getMonth() + 1)
  const [startYear, setStartYear] = useState<number>(now.getFullYear())
  const [frequency, setFrequency] = useState<TechLeadFrequency | ''>('')

  // Equipment-sale lead fields
  const [equipmentTier, setEquipmentTier] = useState<EquipmentSaleTier | ''>('')

  // Lead contact (new in 052) — name required, plus at least one of email/phone.
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  // Machine photos — captured/compressed up-front, uploaded after the lead row
  // exists (we need the lead id to namespace the storage path).
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const pendingPhotosRef = useRef<PendingPhoto[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos
  }, [pendingPhotos])

  // Shared
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // --- Draft persistence ---
  const draftState = useMemo<SubmitLeadDraft>(() => ({
    leadType,
    customerSearch,
    customerId,
    newCustomerMode,
    newCustomerName,
    make,
    model,
    serialNumber,
    locationOnSite,
    startMonth,
    startYear,
    frequency,
    equipmentTier,
    contactName,
    contactEmail,
    contactPhone,
    notes,
  }), [
    leadType, customerSearch, customerId, newCustomerMode, newCustomerName,
    make, model, serialNumber, locationOnSite, startMonth, startYear, frequency,
    equipmentTier, contactName, contactEmail, contactPhone, notes,
  ])

  const { restoredAt, dismissRestoredToast, clearDraft, discardDraft } = useFormDraft<SubmitLeadDraft>({
    key: DRAFT_KEY,
    state: draftState,
    // Drafts are a new-lead affordance. In edit mode we never read or write the
    // draft key — otherwise opening an edit would restore a stale new-lead draft
    // over the pre-filled values, and the edits would pollute the next new lead.
    enabled: open && !isEdit,
    isMeaningful: (s) =>
      Boolean(
        s.customerId ||
        (s.customerSearch && s.customerSearch.trim() !== '') ||
        s.newCustomerName.trim() ||
        s.make.trim() ||
        s.model.trim() ||
        s.serialNumber.trim() ||
        s.locationOnSite.trim() ||
        s.frequency ||
        s.equipmentTier ||
        s.contactName.trim() ||
        s.contactEmail.trim() ||
        s.contactPhone.trim() ||
        s.notes.trim()
      ),
    onRestore: (d) => {
      if (d.leadType === 'pm' || d.leadType === 'equipment_sale') setLeadType(d.leadType)
      setCustomerSearch(d.customerSearch || '')
      setCustomerId(d.customerId ?? null)
      setNewCustomerMode(Boolean(d.newCustomerMode))
      setNewCustomerName(d.newCustomerName || '')
      setMake(d.make || '')
      setModel(d.model || '')
      setSerialNumber(d.serialNumber || '')
      setLocationOnSite(d.locationOnSite || '')
      if (typeof d.startMonth === 'number') setStartMonth(d.startMonth)
      if (typeof d.startYear === 'number') setStartYear(d.startYear)
      setFrequency(d.frequency || '')
      setEquipmentTier(d.equipmentTier || '')
      setContactName(d.contactName || '')
      setContactEmail(d.contactEmail || '')
      setContactPhone(d.contactPhone || '')
      setNotes(d.notes || '')
    },
  })

  function handleDiscardDraft() {
    discardDraft()
    setLeadType('pm')
    setCustomerSearch('')
    setCustomerResults([])
    setCustomerId(null)
    setComboOpen(false)
    setNewCustomerMode(false)
    setNewCustomerName('')
    setMake('')
    setModel('')
    setSerialNumber('')
    setLocationOnSite('')
    const fresh = new Date()
    setStartMonth(fresh.getMonth() + 1)
    setStartYear(fresh.getFullYear())
    setFrequency('')
    setEquipmentTier('')
    setContactName('')
    setContactEmail('')
    setContactPhone('')
    setNotes('')
    setError(null)
    setWarning(null)
  }

  // Prime the form each time the modal opens. In edit mode we pre-fill from the
  // lead; otherwise we reset to a blank new-lead form. Keyed on lead?.id (not the
  // object) so it doesn't re-run on every render and wipe in-progress edits.
  useEffect(() => {
    if (!open) return
    // Common per-open resets (independent of edit vs create).
    setCustomerResults([])
    setComboOpen(false)
    setPendingPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      return []
    })
    setPhotoError(null)
    setWarning(null)
    setError(null)

    if (lead) {
      setLeadType(lead.lead_type)
      if (lead.customer_id) {
        setNewCustomerMode(false)
        setNewCustomerName('')
        setCustomerId(lead.customer_id)
        const c = lead.customers
        setCustomerSearch(
          c ? (c.account_number ? `${c.name} (${c.account_number})` : c.name) : ''
        )
      } else {
        setNewCustomerMode(true)
        setNewCustomerName(lead.customer_name_text ?? '')
        setCustomerId(null)
        setCustomerSearch('')
      }
      setMake(lead.make ?? '')
      setModel(lead.model ?? '')
      setSerialNumber(lead.serial_number ?? '')
      setLocationOnSite(lead.location_on_site ?? '')
      const fresh = new Date()
      setStartMonth(lead.proposed_start_month ?? fresh.getMonth() + 1)
      setStartYear(lead.proposed_start_year ?? fresh.getFullYear())
      setFrequency(lead.proposed_pm_frequency ?? '')
      setEquipmentTier(lead.proposed_equipment_tier ?? '')
      setContactName(lead.contact_name ?? '')
      setContactEmail(lead.contact_email ?? '')
      setContactPhone(lead.contact_phone ?? '')
      setNotes(lead.notes ?? '')
      return
    }

    setLeadType('pm')
    setCustomerSearch('')
    setCustomerId(null)
    setNewCustomerMode(false)
    setNewCustomerName('')
    setMake('')
    setModel('')
    setSerialNumber('')
    setLocationOnSite('')
    const fresh = new Date()
    setStartMonth(fresh.getMonth() + 1)
    setStartYear(fresh.getFullYear())
    setFrequency('')
    setEquipmentTier('')
    setContactName('')
    setContactEmail('')
    setContactPhone('')
    setNotes('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id])

  // Revoke any outstanding object URLs on unmount. Read from the ref so we
  // don't capture an empty initial array.
  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  useEffect(() => {
    // A picked customer keeps its label in `customerSearch` while `customerId`
    // is set — don't re-search or pop the combo for it (matters on edit pre-fill).
    // Typing nulls customerId via the input's onChange, so search-as-you-type
    // still works.
    if (!customerSearch.trim() || newCustomerMode || customerId) {
      setCustomerResults([])
      setComboOpen(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(customerSearch.trim())
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number')
        .or(safeOrRaw([
          { column: 'name', op: 'ilike', raw: `%${q}%` },
          { column: 'account_number', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('name')
        .limit(25)
      setCustomerResults((data as CustomerOption[]) ?? [])
      setComboOpen(true)
      setSearching(false)
    }, 300)
  }, [customerSearch, newCustomerMode, customerId])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function pickCustomer(c: CustomerOption) {
    setCustomerId(c.id)
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setPhotoError(null)
    const room = MAX_PHOTOS - pendingPhotos.length
    const toProcess = Array.from(files).slice(0, room)
    if (files.length > room) {
      setPhotoError(`Only ${MAX_PHOTOS} photos per lead. Extra files were ignored.`)
    }
    try {
      const compressed = await Promise.all(
        toProcess.map(async (file) => {
          const blob = await compressImage(file)
          return {
            id: crypto.randomUUID(),
            blob,
            previewUrl: URL.createObjectURL(blob),
          } as PendingPhoto
        })
      )
      setPendingPhotos((prev) => [...prev, ...compressed])
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not process photo.')
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  function removePendingPhoto(id: string) {
    setPendingPhotos((prev) => {
      const next = prev.filter((p) => {
        if (p.id === id) {
          URL.revokeObjectURL(p.previewUrl)
          return false
        }
        return true
      })
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setWarning(null)

    if (!newCustomerMode && !customerId) {
      setError('Pick an existing customer or tap "+ New customer".')
      return
    }
    if (newCustomerMode && !newCustomerName.trim()) {
      setError('Enter the new customer name.')
      return
    }

    if (!contactName.trim()) {
      setError('Lead contact name is required.')
      return
    }
    if (!contactEmail.trim() && !contactPhone.trim()) {
      setError('Provide a contact email or phone — at least one.')
      return
    }

    let body: Record<string, unknown>
    if (leadType === 'pm') {
      if (!make.trim()) {
        setError('Equipment make is required.')
        return
      }
      if (!model.trim()) {
        setError('Equipment model is required.')
        return
      }
      if (!serialNumber.trim()) {
        setError('Serial number is required.')
        return
      }
      if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
        setError('Pick a proposed start month.')
        return
      }
      if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
        setError('Enter a valid proposed start year.')
        return
      }
      body = {
        lead_type: 'pm',
        customer_id: newCustomerMode ? null : customerId,
        customer_name_text: newCustomerMode ? newCustomerName.trim() : null,
        make: make.trim(),
        model: model.trim(),
        serial_number: serialNumber.trim(),
        location_on_site: locationOnSite.trim() || null,
        proposed_start_month: startMonth,
        proposed_start_year: startYear,
        proposed_pm_frequency: frequency || null,
        notes: notes.trim() || null,
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      }
    } else {
      if (!equipmentTier) {
        setError('Pick the equipment tier.')
        return
      }
      body = {
        lead_type: 'equipment_sale',
        customer_id: newCustomerMode ? null : customerId,
        customer_name_text: newCustomerMode ? newCustomerName.trim() : null,
        proposed_equipment_tier: equipmentTier,
        notes: notes.trim() || null,
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      }
    }

    setSubmitting(true)
    try {
      // 1. Create the lead row (new) or save edits to the existing one.
      let leadId: string | undefined
      if (isEdit && lead) {
        const res = await fetch(`/api/tech-leads/${lead.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const respBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(respBody?.error || 'Failed to save changes.')
        }
        leadId = lead.id
      } else {
        const res = await fetch('/api/tech-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const respBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(respBody?.error || 'Failed to submit lead.')
        }
        leadId = respBody?.id
      }
      let photoWarning: string | null = null
      const savedMsg = isEdit ? 'Changes saved' : 'Lead submitted'

      // 2. Upload photos in parallel and 3. attach to lead
      if (leadId && pendingPhotos.length > 0) {
        try {
          const supabase = createClient()
          const settled = await Promise.allSettled(
            pendingPhotos.map(async (p) => {
              const path = `leads/${leadId}/${p.id}.jpg`
              const { error: upErr } = await supabase.storage
                .from('ticket-photos')
                .upload(path, p.blob, { contentType: 'image/jpeg' })
              if (upErr) throw upErr
              return path
            })
          )
          const uploadedPaths = settled
            .filter((s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled')
            .map((s) => s.value)
          const failures = settled.filter((s) => s.status === 'rejected').length

          if (uploadedPaths.length > 0) {
            const patchRes = await fetch(`/api/tech-leads/${leadId}/photos`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                photos: uploadedPaths.map((storage_path) => ({ storage_path })),
              }),
            })
            if (!patchRes.ok) {
              photoWarning = `${savedMsg}, but photos could not be saved to the lead.`
            }
          }
          if (failures > 0 && !photoWarning) {
            photoWarning = `${savedMsg}, but ${failures} photo${failures > 1 ? 's' : ''} failed to upload.`
          }
        } catch {
          photoWarning = `${savedMsg}, but photos could not be uploaded.`
        }
      }

      // New-lead flow only: the row now exists, so the draft is stale and
      // resubmitting would duplicate it. Edit mode never touches the draft key.
      if (!isEdit) clearDraft()
      if (photoWarning) {
        setWarning(photoWarning)
        setSubmitting(false)
        return
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit lead.')
      setSubmitting(false)
    }
  }

  if (!open) return null

  const selectedFreq = FREQUENCIES.find(f => f.value === frequency)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 sm:rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full sm:max-w-lg sm:mx-4 rounded-t-xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{isEdit ? 'Edit lead' : 'Submit a lead'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {restoredAt !== null && (
            <DraftRestoredToast
              lastEditedAt={restoredAt}
              onDismiss={dismissRestoredToast}
              note="Photos aren't saved in drafts — re-attach them before submitting."
            />
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {warning && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{warning}</p>
          )}

          {/* Lead type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Lead type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLeadType('pm')}
                disabled={isEdit}
                className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  leadType === 'pm'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                PM Lead
              </button>
              <button
                type="button"
                onClick={() => setLeadType('equipment_sale')}
                disabled={isEdit}
                className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  leadType === 'equipment_sale'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                Equipment Sale Lead
              </button>
            </div>
            {isEdit && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Lead type can&apos;t be changed after submitting. To switch, cancel this lead and file a new one.
              </p>
            )}
            {leadType === 'pm' ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Customer is adding equipment to a PM schedule. Bonus = first PM&apos;s flat rate (monthly, bi-monthly, or quarterly only).
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Customer has aging equipment you want replaced. Bonus pays when we sell a qualifying replacement within 90 days.
              </p>
            )}
          </div>

          {/* Customer */}
          <div ref={comboRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            {!newCustomerMode ? (
              <>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={e => {
                    setCustomerSearch(e.target.value)
                    setCustomerId(null)
                  }}
                  onFocus={() => { if (customerResults.length > 0) setComboOpen(true) }}
                  placeholder="Search by name or account number..."
                  autoComplete="off"
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                {searching && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>}
                {comboOpen && customerResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
                    {customerResults.map(c => (
                      <li
                        key={c.id}
                        onMouseDown={() => pickCustomer(c)}
                        className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 flex justify-between items-center gap-2 min-h-[44px]"
                      >
                        <span className="text-gray-900 dark:text-white truncate">{c.name}</span>
                        {c.account_number && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">{c.account_number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerMode(true)
                    setCustomerId(null)
                    setCustomerSearch('')
                    setComboOpen(false)
                  }}
                  className="mt-2 text-sm text-slate-600 dark:text-slate-300 hover:underline"
                >
                  + New customer (not in system)
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="New customer company name"
                  autoComplete="off"
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerMode(false)
                    setNewCustomerName('')
                  }}
                  className="mt-2 text-sm text-slate-600 dark:text-slate-300 hover:underline"
                >
                  ← Pick existing customer
                </button>
              </>
            )}
          </div>

          {/* Lead contact */}
          <div className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-white">Lead contact</h4>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Email or phone required so we can follow up.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Contact name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                placeholder="Who to ask for on site"
                autoComplete="name"
                className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <input
                type="email"
                inputMode="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Phone
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="(205) 555-0100"
                autoComplete="tel"
                className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          {leadType === 'pm' ? (
            <>
              {/* Structured equipment fields (PM only) */}
              <div className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Equipment</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Make <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={make}
                    onChange={e => setMake(e.target.value)}
                    placeholder="e.g., Tennant"
                    autoComplete="off"
                    maxLength={200}
                    className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Model <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="e.g., T16"
                    autoComplete="off"
                    maxLength={200}
                    className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Serial number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={serialNumber}
                    onChange={e => setSerialNumber(e.target.value)}
                    placeholder="From the data plate"
                    autoComplete="off"
                    maxLength={200}
                    className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Location on-site
                  </label>
                  <input
                    type="text"
                    value={locationOnSite}
                    onChange={e => setLocationOnSite(e.target.value)}
                    placeholder="Warehouse, dock 3, etc."
                    autoComplete="off"
                    maxLength={200}
                    className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              </div>

              {/* Proposed start month/year (required) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Proposed start <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={startMonth}
                    onChange={e => setStartMonth(parseInt(e.target.value, 10))}
                    aria-label="Proposed start month"
                    className="min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  >
                    {MONTHS.map((label, idx) => (
                      <option key={idx + 1} value={idx + 1}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={2000}
                    max={2100}
                    value={startYear}
                    onChange={e => {
                      const parsed = parseInt(e.target.value, 10)
                      if (Number.isFinite(parsed)) setStartYear(parsed)
                    }}
                    aria-label="Proposed start year"
                    className="min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  When should the office plan to start the PM cycle?
                </p>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Proposed PM frequency
                </label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as TechLeadFrequency)}
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">Not sure / leave to manager</option>
                  {FREQUENCIES.map(f => (
                    <option key={f.value} value={f.value}>
                      {f.label}{!f.eligible ? ' — no bonus' : ''}
                    </option>
                  ))}
                </select>
                {selectedFreq && !selectedFreq.eligible && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Semi-annual and annual PMs are not eligible for a lead bonus.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Equipment tier (Equipment sale only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Equipment tier <span className="text-red-500">*</span>
                </label>
                <select
                  value={equipmentTier}
                  onChange={e => setEquipmentTier(e.target.value as EquipmentSaleTier)}
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">Select tier…</option>
                  {EQUIPMENT_SALE_TIER_LIST.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label} — ${t.amount}
                    </option>
                  ))}
                </select>
                {equipmentTier === 'cord_electric' && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Excludes vacuums, fans, and extractors under 10 gallon.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Machine photos */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Machine photos
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Snap the machine, data plate, or anything that helps the office identify it.
            </p>
            {isEdit && existingPhotoCount > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {existingPhotoCount} photo{existingPhotoCount > 1 ? 's' : ''} already attached. New photos are added to the lead.
              </p>
            )}
            {pendingPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {pendingPhotos.map(p => (
                  <div
                    key={p.id}
                    className="relative aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.previewUrl}
                      alt="Machine"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingPhoto(p.id)}
                      aria-label="Remove photo"
                      className="absolute top-1 right-1 flex items-center justify-center bg-black/60 hover:bg-black/75 text-white rounded-full"
                      style={{ minHeight: 32, minWidth: 32 }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingPhotos.length < MAX_PHOTOS && (
              <label className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600">
                <Camera className="h-4 w-4" />
                {pendingPhotos.length === 0 ? 'Add photos' : 'Add more'}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
              </label>
            )}
            {photoError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{photoError}</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={leadType === 'equipment_sale'
                ? 'Make, model, serial #, location, condition…'
                : 'Anything the office should know...'}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {isEdit ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={handleDiscardDraft}
                disabled={submitting}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline underline-offset-2 disabled:opacity-50"
              >
                Discard draft
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-md disabled:opacity-50"
              >
                {isEdit
                  ? (submitting ? 'Saving…' : 'Save changes')
                  : (submitting ? 'Submitting…' : 'Submit lead')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
