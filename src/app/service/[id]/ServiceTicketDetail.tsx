'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import SignaturePad from '@/components/SignaturePad'
import ReadOnlyPhotos from '@/components/ReadOnlyPhotos'
import PartsEntryList, { PartEntry, emptyPart, partsFromSaved, toServicePartUsed } from '@/components/service/PartsEntryList'
import PartSynergyPicker from '@/components/PartSynergyPicker'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import { getPublicAppUrl } from '@/lib/urls'
import RegisterEquipmentPanel from './RegisterEquipmentPanel'
import type {
  ServiceTicketDetail as ServiceTicketDetailType,
  ServiceTicketStatus,
  PartRequest,
  ServicePartUsed,
} from '@/types/service-tickets'
import type { UserRole, TicketPhoto } from '@/types/database'

// ── Types ──

interface ServiceTicketDetailProps {
  ticket: ServiceTicketDetailType
  userRole: UserRole | null
  userId: string
  laborRate: number
}

const priorityConfig: Record<string, { label: string; classes: string }> = {
  emergency: { label: 'Emergency', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  standard: { label: 'Standard', classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
  low: { label: 'Low', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
}

const ticketTypeConfig: Record<string, { label: string; classes: string }> = {
  inside: { label: 'Inside', classes: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
  outside: { label: 'Outside', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
}

const billingTypeLabels: Record<string, string> = {
  non_warranty: 'Non-Warranty',
  warranty: 'Warranty',
  partial_warranty: 'Partial Warranty',
}

// ── Component ──

// ── Render helpers (must be outside component to avoid remount on re-render) ──

function Badge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 ${className}`}>
      {title && (
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            {title}
          </h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-gray-500 dark:text-gray-400 text-sm">{label}</span>
      <p className="text-gray-900 dark:text-white font-medium text-sm">{children}</p>
    </div>
  )
}

export function ServiceTicketDetail({ ticket, userRole, userId, laborRate }: ServiceTicketDetailProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'
  const isManager = userRole === 'super_admin' || userRole === 'manager'
  const isStaff = !isTech && userRole !== null

  // --- State ---
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Estimate form
  const [showEstimateForm, setShowEstimateForm] = useState(false)
  const [estimateLaborHours, setEstimateLaborHours] = useState(
    ticket.estimate_labor_hours != null ? String(ticket.estimate_labor_hours) : ''
  )
  const [estimateParts, setEstimateParts] = useState<PartEntry[]>(
    ticket.estimate_parts && ticket.estimate_parts.length > 0
      ? partsFromSaved(ticket.estimate_parts)
      : []
  )
  const [diagnosisNotes, setDiagnosisNotes] = useState(ticket.diagnosis_notes ?? '')

  // Manual approve/decline note capture
  const [manualDecisionMode, setManualDecisionMode] = useState<null | 'approve' | 'decline'>(null)
  const [manualDecisionNote, setManualDecisionNote] = useState('')

  // Parts requested
  const [partsRequested, setPartsRequested] = useState<PartRequest[]>(ticket.parts_requested ?? [])
  const [showAddPart, setShowAddPart] = useState(false)
  const [newPartDesc, setNewPartDesc] = useState('')
  const [newPartQty, setNewPartQty] = useState('1')
  const [newPartNumber, setNewPartNumber] = useState('')
  const [newPartVendorItemCode, setNewPartVendorItemCode] = useState('')

  // Completion form
  const [showCompletionForm, setShowCompletionForm] = useState(false)
  const [hoursWorked, setHoursWorked] = useState(
    ticket.hours_worked != null ? String(ticket.hours_worked) : ''
  )
  const [completionNotes, setCompletionNotes] = useState(ticket.completion_notes ?? '')
  const [completionParts, setCompletionParts] = useState<PartEntry[]>(
    ticket.parts_used && ticket.parts_used.length > 0
      ? partsFromSaved(ticket.parts_used)
      : []
  )
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')

  // Photos
  const [photos, setPhotos] = useState<Array<TicketPhoto & { previewUrl?: string }>>(
    ticket.photos && ticket.photos.length > 0 ? ticket.photos : []
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Billing / Synergy
  const [synergyOrderNumber, setSynergyOrderNumber] = useState(ticket.synergy_order_number ?? '')
  const [diagnosticCharge, setDiagnosticCharge] = useState(
    ticket.diagnostic_charge != null ? String(ticket.diagnostic_charge) : ''
  )
  const [diagnosticInvoiceNumber, setDiagnosticInvoiceNumber] = useState(
    ticket.diagnostic_invoice_number ?? ''
  )

  // Equipment registration (for tickets with denormalized equipment fields)
  const [registeringEquipment, setRegisteringEquipment] = useState(false)

  // Contact edit state — staff can update name/email/phone after submission
  const [editingContact, setEditingContact] = useState(false)
  const [contactDraftName, setContactDraftName] = useState(ticket.contact_name ?? '')
  const [contactDraftEmail, setContactDraftEmail] = useState(ticket.contact_email ?? '')
  const [contactDraftPhone, setContactDraftPhone] = useState(ticket.contact_phone ?? '')

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

  // ── API Helpers ──

  async function patchTicket(body: Record<string, unknown>) {
    const res = await fetch(`/api/service-tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Request failed')
    }
    return res.json()
  }

  async function apiAction(fn: () => Promise<void>) {
    setLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await fn()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // ── Photo handlers ──

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const supabase = createClient()
      // Upload in parallel — Supabase Storage handles concurrent writes; each
      // path is uniquely UUID'd. Serial awaits added 5x latency on 5-photo
      // uploads over cellular.
      const newPhotos = await Promise.all(
        Array.from(files).map(async (file) => {
          const compressed = await compressImage(file)
          const id = crypto.randomUUID()
          const path = `${ticket.id}/${id}.jpg`
          const { error: uploadError } = await supabase.storage
            .from('ticket-photos')
            .upload(path, compressed, { contentType: 'image/jpeg' })
          if (uploadError) throw uploadError
          return {
            storage_path: path,
            uploaded_at: new Date().toISOString(),
            previewUrl: URL.createObjectURL(compressed),
          } as TicketPhoto & { previewUrl?: string }
        })
      )
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
    const { error: removeError } = await supabase.storage
      .from('ticket-photos')
      .remove([photo.storage_path])
    if (removeError) {
      setError('Failed to delete photo. Please try again.')
      return
    }
    if (photo.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(photo.previewUrl)
    }
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Actions ──

  async function handleSubmitEstimate(e: React.FormEvent) {
    e.preventDefault()
    const hours = parseFloat(estimateLaborHours) || 0
    if (hours < 0) {
      setError('Labor hours cannot be negative')
      return
    }
    await apiAction(async () => {
      const result = await patchTicket({
        status: 'estimated',
        estimate_labor_hours: hours,
        estimate_parts: toServicePartUsed(estimateParts),
        diagnosis_notes: diagnosisNotes || null,
      })
      if (result.status === 'approved') {
        setSuccessMsg('Estimate auto-approved (under $100)')
      }
      setShowEstimateForm(false)
    })
  }

  async function handleApproveEstimate(note: string) {
    await apiAction(async () => {
      await patchTicket({
        estimate_approved: true,
        estimate_approved_at: new Date().toISOString(),
        status: 'approved',
        manual_decision_note: note,
      })
      setManualDecisionMode(null)
      setManualDecisionNote('')
    })
  }

  async function handleDeclineEstimate(note: string) {
    await apiAction(async () => {
      await patchTicket({
        status: 'declined',
        manual_decision_note: note,
      })
      setManualDecisionMode(null)
      setManualDecisionNote('')
    })
  }

  async function handleDownloadEstimate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}/estimate-pdf`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to generate estimate PDF')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'estimate.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download estimate')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailEstimate() {
    if (!ticket.contact_email) {
      setError('No contact email on this ticket — add one before emailing the estimate.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}/send-estimate`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to send estimate email')
      }
      setSuccessMsg(`Estimate emailed to ${ticket.contact_email}.`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send estimate email')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveContact() {
    const name = contactDraftName.trim()
    const email = contactDraftEmail.trim()
    const phone = contactDraftPhone.trim()
    await apiAction(async () => {
      await patchTicket({
        contact_name: name || null,
        contact_email: email || null,
        contact_phone: phone || null,
      })
      setEditingContact(false)
      setSuccessMsg('Contact updated')
    })
  }

  function handleCancelContactEdit() {
    setContactDraftName(ticket.contact_name ?? '')
    setContactDraftEmail(ticket.contact_email ?? '')
    setContactDraftPhone(ticket.contact_phone ?? '')
    setEditingContact(false)
  }

  async function handleSubmitDiagnosticCharge() {
    const trimmedAmount = diagnosticCharge.trim()
    const trimmedInvoice = diagnosticInvoiceNumber.trim()
    let amount: number | null = null
    if (trimmedAmount) {
      const parsed = parseFloat(trimmedAmount)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Please enter a valid diagnostic charge')
        return
      }
      amount = parsed
    }
    await apiAction(async () => {
      await patchTicket({
        diagnostic_charge: amount,
        diagnostic_invoice_number: trimmedInvoice || null,
      })
      setSuccessMsg('Diagnostic fee saved')
    })
  }

  async function handleStartWork() {
    await apiAction(async () => {
      await patchTicket({ status: 'in_progress' })
    })
  }

  async function handleRequestEstimatePart(index: number) {
    const entry = estimateParts[index]
    if (!entry || !entry.description.trim() || entry.alreadyRequested) return
    const newPart: PartRequest = {
      description: entry.description.trim(),
      quantity: entry.quantity || 1,
      product_number: entry.productNumber?.trim() || undefined,
      synergy_product_id: entry.synergyProductId ?? undefined,
      status: 'requested',
      requested_at: new Date().toISOString(),
    }
    const updatedRequests = [...partsRequested, newPart]
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedRequests })
      setPartsRequested(updatedRequests)
      setEstimateParts((prev) => {
        const u = [...prev]
        if (u[index]) u[index] = { ...u[index], alreadyRequested: true }
        return u
      })
    })
  }

  async function handleAddPartRequest() {
    if (!newPartDesc.trim()) return
    const newPart: PartRequest = {
      description: newPartDesc.trim(),
      quantity: parseInt(newPartQty) || 1,
      product_number: newPartNumber.trim() || undefined,
      vendor_item_code: newPartVendorItemCode.trim() || undefined,
      status: 'requested',
      requested_at: new Date().toISOString(),
    }
    const updatedParts = [...partsRequested, newPart]
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedParts })
      setPartsRequested(updatedParts)
      setNewPartDesc('')
      setNewPartQty('1')
      setNewPartNumber('')
      setNewPartVendorItemCode('')
      setShowAddPart(false)
    })
  }

  async function handleUpdatePartStatus(index: number, status: PartRequest['status']) {
    if (status === 'ordered') {
      if (!synergyOrderNumber.trim()) {
        setError('Enter the Synergy Order # below before marking parts ordered.')
        return
      }
      const part = partsRequested[index]
      if (!part.product_number?.trim()) {
        setError('Enter the Synergy item # for this part before marking it ordered.')
        return
      }
    }
    const updatedParts = [...partsRequested]
    updatedParts[index] = { ...updatedParts[index], status }
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedParts })
      setPartsRequested(updatedParts)
    })
  }

  async function handleSavePartSynergy(index: number, next: { product_number: string; synergy_product_id: number | null }) {
    const updatedParts = partsRequested.map((p, i) =>
      i === index
        ? {
            ...p,
            product_number: next.product_number,
            synergy_product_id: next.synergy_product_id ?? undefined,
          }
        : p
    )
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedParts })
      setPartsRequested(updatedParts)
    })
  }

  function handleUpdatePartPo(index: number, poNumber: string) {
    const updatedParts = [...partsRequested]
    updatedParts[index] = { ...updatedParts[index], po_number: poNumber || undefined }
    setPartsRequested(updatedParts)
  }

  async function handleSavePartPo(index: number) {
    // Read-before-write: pull the latest server state, merge our single field
    // change in, then write back. Reduces (but doesn't eliminate) the
    // race window where two staff PATCH the array concurrently and one wins.
    await apiAction(async () => {
      const supabase = createClient()
      const { data: latest } = await supabase
        .from('service_tickets')
        .select('parts_requested')
        .eq('id', ticket.id)
        .single()
      const serverParts = (latest?.parts_requested ?? []) as PartRequest[]
      const merged = serverParts.map((p, i) =>
        i === index ? { ...p, po_number: partsRequested[index]?.po_number } : p
      )
      await patchTicket({ parts_requested: merged })
    })
  }

  function handleUpdatePartVendorItemCode(index: number, code: string) {
    const updatedParts = [...partsRequested]
    updatedParts[index] = { ...updatedParts[index], vendor_item_code: code || undefined }
    setPartsRequested(updatedParts)
  }

  async function handleSavePartVendorItemCode(index: number) {
    // Read-before-write merge — same pattern as handleSavePartPo.
    await apiAction(async () => {
      const supabase = createClient()
      const { data: latest } = await supabase
        .from('service_tickets')
        .select('parts_requested')
        .eq('id', ticket.id)
        .single()
      const serverParts = (latest?.parts_requested ?? []) as PartRequest[]
      const merged = serverParts.map((p, i) =>
        i === index ? { ...p, vendor_item_code: partsRequested[index]?.vendor_item_code } : p
      )
      await patchTicket({ parts_requested: merged })
    })
  }

  async function handleResetPartStatus(index: number) {
    const current = partsRequested[index].status
    const prev: PartRequest['status'] = current === 'received' ? 'ordered' : 'requested'
    const updatedParts = partsRequested.map((p, i) => i === index ? { ...p, status: prev } : p)
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedParts })
      setPartsRequested(updatedParts)
    })
  }

  async function handleSaveSynergyOrderNumber(synergyOrder: string) {
    await apiAction(async () => {
      await patchTicket({
        synergy_order_number: synergyOrder || null,
      })
      setSynergyOrderNumber(synergyOrder)
    })
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault()

    const signatureRequired = ticket.ticket_type !== 'inside'
    if (signatureRequired && (!signatureImage || !signatureName.trim())) {
      setError('Customer signature and printed name are required.')
      return
    }

    const hours = parseFloat(hoursWorked)
    if (isNaN(hours) || hours < 0) {
      setError('Please enter valid hours worked.')
      return
    }

    await apiAction(async () => {
      const res = await fetch(`/api/service-tickets/${ticket.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_at: new Date().toISOString(),
          hours_worked: hours,
          parts_used: toServicePartUsed(completionParts),
          completion_notes: completionNotes || null,
          customer_signature: signatureImage || null,
          customer_signature_name: signatureName.trim() || null,
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to complete ticket')
      }
    })
  }

  async function handleMarkBilled() {
    if (!synergyOrderNumber.trim()) {
      setError('Synergy order number is required to mark as billed')
      return
    }
    await apiAction(async () => {
      await patchTicket({
        status: 'billed',
        synergy_order_number: synergyOrderNumber.trim(),
      })
    })
  }

  async function handleTogglePickup() {
    await apiAction(async () => {
      if (ticket.awaiting_pickup && !ticket.picked_up_at) {
        await patchTicket({ picked_up_at: new Date().toISOString(), awaiting_pickup: false })
      } else {
        await patchTicket({ awaiting_pickup: !ticket.awaiting_pickup, picked_up_at: null })
      }
    })
  }

  async function handleReopen() {
    if (!confirm('Reopen this ticket? Completion data will be cleared.')) return
    await apiAction(async () => {
      await patchTicket({ status: 'open' })
    })
  }

  async function handleCancel() {
    if (!confirm('Cancel this ticket?')) return
    await apiAction(async () => {
      await patchTicket({ status: 'canceled' })
    })
  }

  async function handleDelete() {
    if (!confirm('Permanently delete this ticket? This cannot be undone.')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete ticket')
      }
      router.push('/service')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // ── Computed ──

  const partsReceivedCount = partsRequested.filter((p) => p.status === 'received').length
  const allPartsReceived = partsRequested.length > 0 && partsReceivedCount === partsRequested.length
  const partsTotal = completionParts
    .filter((p) => !p.warrantyCovered)
    .reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)
  const laborTotal = (parseFloat(hoursWorked) || 0) * laborRate
  const billingTotal = ticket.billing_type === 'warranty' ? 0 : laborTotal + partsTotal

  // Estimate computed totals
  const estLaborTotal = (parseFloat(estimateLaborHours) || 0) * laborRate
  const estPartsTotal = estimateParts
    .filter((p) => !p.warrantyCovered)
    .reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)
  const estTotal = ticket.billing_type === 'warranty' ? 0 : estLaborTotal + estPartsTotal

  // Service address
  const serviceAddress = ticket.ticket_type === 'outside'
    ? [
        ticket.service_address || ticket.equipment?.ship_to_locations?.address,
        ticket.service_city || ticket.equipment?.ship_to_locations?.city,
        ticket.service_state || ticket.equipment?.ship_to_locations?.state,
        ticket.service_zip || ticket.equipment?.ship_to_locations?.zip,
      ].filter(Boolean).join(', ')
    : null

  // Equipment info
  const equipMake = ticket.equipment?.make ?? ticket.equipment_make
  const equipModel = ticket.equipment?.model ?? ticket.equipment_model
  const equipSerial = ticket.equipment?.serial_number ?? ticket.equipment_serial_number

  // (Render helpers moved outside component — see Badge, Card, InfoField above)

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Error / Success messages */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-300">{successMsg}</p>
        </div>
      )}

      {/* Credit hold alert */}
      {ticket.customers?.credit_hold && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-800 px-4 py-3 flex items-center gap-3">
          <CreditHoldBadge />
          <span className="text-sm text-red-800 dark:text-red-300 font-semibold">
            This customer is on credit hold. Verify with office before dispatching, sending an estimate, or billing.
          </span>
        </div>
      )}

      {/* Synergy validation warning */}
      {ticket.synergy_validation_status === 'invalid' && ticket.synergy_order_number && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-4 py-3 flex items-center gap-2">
          <svg className="h-5 w-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-300">
            Synergy order # <strong>{ticket.synergy_order_number}</strong> not found in ERP — verify and correct
          </p>
        </div>
      )}

      {/* ── Section 1: Header Badges ── */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <ServiceStatusBadge status={ticket.status} />
          {priorityConfig[ticket.priority] && (
            <Badge {...priorityConfig[ticket.priority]} />
          )}
          {ticketTypeConfig[ticket.ticket_type] && (
            <Badge {...ticketTypeConfig[ticket.ticket_type]} />
          )}
          <Badge
            label={billingTypeLabels[ticket.billing_type] ?? ticket.billing_type}
            classes="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
          />
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
            Created {new Date(ticket.created_at).toLocaleDateString()}
            {ticket.assigned_technician && (
              <> | Assigned to <span className="font-medium text-gray-700 dark:text-gray-300">{ticket.assigned_technician.name}</span></>
            )}
          </span>
        </div>
      </Card>

      {/* ── Section 2: Customer & Equipment Info ── */}
      <Card title="Customer & Equipment">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <InfoField label="Customer">
            {ticket.customers ? (
              <Link href={`/customers/${ticket.customer_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                {ticket.customers.name}
              </Link>
            ) : '—'}
          </InfoField>
          <InfoField label="Account Number">
            {ticket.customers?.account_number ?? '—'}
          </InfoField>
          <InfoField label="Equipment">
            {[equipMake, equipModel].filter(Boolean).join(' ') || '—'}
            {ticket.equipment_id && (
              <Link
                href={`/equipment/${ticket.equipment_id}`}
                className="inline-flex items-center ml-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
            {isStaff && !ticket.equipment_id && (ticket.equipment_make || ticket.equipment_model || ticket.equipment_serial_number) && (
              !registeringEquipment ? (
                <button
                  type="button"
                  onClick={() => setRegisteringEquipment(true)}
                  className="block mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Register equipment profile
                </button>
              ) : (
                <RegisterEquipmentPanel
                  ticketId={ticket.id}
                  customerId={ticket.customer_id}
                  shipToId={ticket.ship_to_location_id ?? null}
                  make={ticket.equipment_make ?? null}
                  model={ticket.equipment_model ?? null}
                  serial={ticket.equipment_serial_number ?? null}
                  onDone={() => router.refresh()}
                  onCancel={() => setRegisteringEquipment(false)}
                />
              )
            )}
          </InfoField>
          <InfoField label="Serial Number">
            {equipSerial ?? '—'}
          </InfoField>
          {/* Contact — staff can edit; techs see read-only */}
          {isStaff ? (
            <InfoField label="Contact">
              {editingContact ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={contactDraftName}
                    onChange={(e) => setContactDraftName(e.target.value)}
                    placeholder="Contact name"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <input
                    type="email"
                    value={contactDraftEmail}
                    onChange={(e) => setContactDraftEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <input
                    type="tel"
                    value={contactDraftPhone}
                    onChange={(e) => setContactDraftPhone(e.target.value)}
                    placeholder="(205) 555-1234"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveContact}
                      disabled={loading}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                      {loading ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelContactEdit}
                      disabled={loading}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {ticket.contact_name || ticket.contact_email || ticket.contact_phone ? (
                      <>
                        {ticket.contact_name ?? ''}
                        {ticket.contact_email && <span className="text-gray-500 dark:text-gray-400"> | {ticket.contact_email}</span>}
                        {ticket.contact_phone && <span className="text-gray-500 dark:text-gray-400"> | {ticket.contact_phone}</span>}
                      </>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 italic">No contact on file</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingContact(true)}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </InfoField>
          ) : (
            (ticket.contact_name || ticket.contact_email || ticket.contact_phone) && (
              <InfoField label="Contact">
                {ticket.contact_name ?? ''}
                {ticket.contact_email && <span className="text-gray-500 dark:text-gray-400"> | {ticket.contact_email}</span>}
                {ticket.contact_phone && <span className="text-gray-500 dark:text-gray-400"> | {ticket.contact_phone}</span>}
              </InfoField>
            )
          )}
          {serviceAddress && (
            <InfoField label="Service Address">
              {serviceAddress}
            </InfoField>
          )}
          {isTech && (ticket.diagnostic_charge != null || ticket.diagnostic_invoice_number) && (
            <InfoField label="Diagnostic Billed">
              {ticket.diagnostic_charge != null && `$${ticket.diagnostic_charge.toFixed(2)}`}
              {ticket.diagnostic_invoice_number && (
                <>
                  {ticket.diagnostic_charge != null && ' '}
                  on invoice #{ticket.diagnostic_invoice_number}
                </>
              )}
            </InfoField>
          )}
          {ticket.customers?.po_required && (
            <InfoField label="PO Required">
              <span className="text-red-700 dark:text-red-400 font-bold">YES — PO REQUIRED</span>
            </InfoField>
          )}
          {ticket.customers?.credit_hold && (
            <InfoField label="Credit Hold">
              <span className="text-red-700 dark:text-red-400 font-bold">CREDIT HOLD</span>
            </InfoField>
          )}
        </div>
      </Card>

      {/* ── Section 3: Problem Description ── */}
      <Card title="Problem Description">
        <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
          {ticket.problem_description}
        </p>
      </Card>

      {/* ── Section 4: Diagnosis & Estimate ── */}
      {(ticket.status === 'open' || ticket.status === 'estimated' || ticket.status === 'approved' ||
        ticket.status === 'declined' || ticket.estimate_amount != null) && (
        <Card title="Diagnosis & Estimate">
          {/* Show existing estimate breakdown */}
          {ticket.estimate_amount != null && (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <InfoField label="Approval Status">
                  {ticket.estimate_approved ? (
                    <span className="text-green-600 dark:text-green-400">
                      Approved
                      {ticket.auto_approved && (
                        <span className="ml-1 text-xs">(auto &lt; $100)</span>
                      )}
                    </span>
                  ) : ticket.status === 'declined' ? (
                    <span className="text-red-600 dark:text-red-400">Declined</span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-400">Pending Approval</span>
                  )}
                </InfoField>
              </div>

              {/* Itemized breakdown */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {ticket.estimate_labor_hours != null && ticket.estimate_labor_rate != null && (
                    <div className="flex justify-between">
                      <span>Labor: {ticket.estimate_labor_hours} hrs x ${ticket.estimate_labor_rate.toFixed(2)}/hr</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${(ticket.estimate_labor_hours * ticket.estimate_labor_rate).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {ticket.estimate_parts && ticket.estimate_parts.length > 0 && (
                    <>
                      {ticket.estimate_parts.map((part, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="truncate mr-4">
                            {part.description} x{part.quantity}
                            {part.warranty_covered && (
                              <span className="ml-1 text-xs text-green-600 dark:text-green-400">(warranty)</span>
                            )}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white shrink-0">
                            {part.warranty_covered ? '$0.00' : `$${(part.quantity * part.unit_price).toFixed(2)}`}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">Estimate Total</span>
                  <span className="text-base font-bold text-gray-900 dark:text-white">${ticket.estimate_amount.toFixed(2)}</span>
                </div>
              </div>

              {ticket.diagnosis_notes && (
                <InfoField label="Diagnosis Notes">
                  <span className="font-normal whitespace-pre-wrap">{ticket.diagnosis_notes}</span>
                </InfoField>
              )}

              {/* Customer approval display */}
              {ticket.estimate_approved && ticket.estimate_signature && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                    Estimate Approved
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Approved by {ticket.estimate_signature_name ?? 'Customer'}
                    {ticket.estimate_approved_at && (
                      <> on {new Date(ticket.estimate_approved_at).toLocaleDateString()}</>
                    )}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ticket.estimate_signature}
                    alt="Customer signature"
                    className="max-w-xs h-16 border border-gray-200 dark:border-gray-700 rounded bg-white"
                  />
                </div>
              )}

              {/* Manual decision note — staff override approve/decline path */}
              {ticket.manual_decision_note && (ticket.status === 'approved' || ticket.status === 'declined') && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Manual Decision Note
                    {(ticket.estimate_approved_at || ticket.updated_at) && (
                      <span className="ml-2 normal-case font-normal text-gray-400 dark:text-gray-500">
                        {new Date(ticket.estimate_approved_at ?? ticket.updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                  <p className="text-sm italic text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                    {ticket.manual_decision_note}
                  </p>
                </div>
              )}

              {/* Download / Email estimate */}
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleDownloadEstimate}
                  disabled={loading}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  Download Estimate PDF
                </button>
                <button
                  onClick={handleEmailEstimate}
                  disabled={loading}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  Email Estimate
                </button>
              </div>

              {/* Approval link display */}
              {ticket.status === 'estimated' && ticket.approval_token && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {ticket.approval_token_expires_at && new Date(ticket.approval_token_expires_at) > new Date() ? (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Approval Link</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={`${getPublicAppUrl()}/e/${ticket.approval_token}`}
                          className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-xs w-full focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`${getPublicAppUrl()}/e/${ticket.approval_token}`)
                            setSuccessMsg('Approval link copied to clipboard')
                          }}
                          className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 transition-colors shrink-0"
                        >
                          Copy
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleEmailEstimate}
                        disabled={loading}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                      >
                        Resend Approval Link
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400">Approval link expired</p>
                      <button
                        type="button"
                        onClick={handleEmailEstimate}
                        disabled={loading}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                      >
                        Resend Approval Link
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Estimate action buttons for staff (approve/decline).
              Both paths require a note explaining who told us — shown via
              an inline-expand textarea before the action commits. */}
          {ticket.status === 'estimated' && isStaff && (
            <div className="mt-3">
              {manualDecisionMode === null ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setManualDecisionMode('approve')
                      setManualDecisionNote('')
                    }}
                    disabled={loading}
                    className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Approve Estimate
                  </button>
                  <button
                    onClick={() => {
                      setManualDecisionMode('decline')
                      setManualDecisionNote('')
                    }}
                    disabled={loading}
                    className="px-4 py-3 sm:py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-w-lg">
                  <label htmlFor="manual-decision-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {manualDecisionMode === 'approve'
                      ? 'Who told us to approve? (required)'
                      : 'Why are we declining? (required for the record)'}
                  </label>
                  <textarea
                    id="manual-decision-note"
                    autoFocus
                    value={manualDecisionNote}
                    onChange={(e) => setManualDecisionNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder={manualDecisionMode === 'approve'
                      ? 'e.g. Spoke with John Smith on phone 4/29 — approved verbally'
                      : 'e.g. Customer chose another vendor — confirmed by email 4/29'}
                    className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        const note = manualDecisionNote.trim()
                        if (manualDecisionMode === 'approve') {
                          handleApproveEstimate(note)
                        } else {
                          handleDeclineEstimate(note)
                        }
                      }}
                      disabled={loading || manualDecisionNote.trim().length < 2}
                      className={`px-4 py-3 sm:py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 transition-colors min-h-[44px] ${
                        manualDecisionMode === 'approve'
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {loading
                        ? (manualDecisionMode === 'approve' ? 'Approving...' : 'Declining...')
                        : (manualDecisionMode === 'approve' ? 'Confirm Approve' : 'Confirm Decline')}
                    </button>
                    <button
                      onClick={() => {
                        setManualDecisionMode(null)
                        setManualDecisionNote('')
                      }}
                      disabled={loading}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Decline reason */}
          {ticket.status === 'declined' && ticket.decline_reason && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <InfoField label="Decline Reason">
                <span className="font-normal text-red-600 dark:text-red-400">{ticket.decline_reason}</span>
              </InfoField>
            </div>
          )}

          {/* Reopen & Revise for declined tickets */}
          {ticket.status === 'declined' && (
            <div className="mt-3">
              <button
                onClick={handleReopen}
                disabled={loading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Reopen &amp; Revise Estimate
              </button>
            </div>
          )}

          {/* Diagnostic fee — staff can capture / edit anytime while the ticket is live */}
          {isStaff && ticket.status !== 'billed' && ticket.status !== 'canceled' && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Diagnostic Fee <span className="normal-case font-normal text-gray-400 dark:text-gray-500">(if billed separately in Synergy)</span>
              </p>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Synergy Invoice #
                  </label>
                  <input
                    type="text"
                    value={diagnosticInvoiceNumber}
                    onChange={(e) => setDiagnosticInvoiceNumber(e.target.value)}
                    placeholder="e.g. 612978"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Amount
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 dark:text-gray-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={diagnosticCharge}
                      onChange={(e) => setDiagnosticCharge(e.target.value)}
                      placeholder="0.00"
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSubmitDiagnosticCharge}
                  disabled={loading}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  Save
                </button>
              </div>
              {(ticket.diagnostic_charge != null || ticket.diagnostic_invoice_number) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Current:
                  {ticket.diagnostic_charge != null && ` $${ticket.diagnostic_charge.toFixed(2)}`}
                  {ticket.diagnostic_invoice_number && ` on invoice #${ticket.diagnostic_invoice_number}`}
                </p>
              )}
            </div>
          )}

          {/* Submit estimate form — techs or staff when ticket is open */}
          {ticket.status === 'open' && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              {!showEstimateForm ? (
                <button
                  onClick={() => setShowEstimateForm(true)}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-yellow-600 rounded-md hover:bg-yellow-700 transition-colors min-h-[44px]"
                >
                  Submit Estimate
                </button>
              ) : (
                <form onSubmit={handleSubmitEstimate} className="space-y-4 mt-3">
                  {/* Labor Hours */}
                  <div className="max-w-lg">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Estimated Labor Hours
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={estimateLaborHours}
                        onChange={(e) => setEstimateLaborHours(e.target.value)}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="0.00"
                      />
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        @ ${laborRate.toFixed(2)}/hr
                      </span>
                    </div>
                  </div>

                  {/* Estimated Parts */}
                  <PartsEntryList
                    parts={estimateParts}
                    setParts={setEstimateParts}
                    showPricing={true}
                    showWarranty={ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty'}
                    label="Estimated Parts"
                    onRequestPart={handleRequestEstimatePart}
                  />

                  {/* Estimate summary */}
                  <div className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3 max-w-lg">
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Labor: {estimateLaborHours || '0'} hrs x ${laborRate.toFixed(2)}</span>
                        <span>${estLaborTotal.toFixed(2)}</span>
                      </div>
                      {estimateParts.length > 0 && (
                        <div className="flex justify-between">
                          <span>Parts {ticket.billing_type === 'warranty' ? '(warranty — $0)' : ''}</span>
                          <span>${estPartsTotal.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-300 dark:border-gray-700">
                      <span className="text-base font-bold text-gray-900 dark:text-white">Estimate Total</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-white">${estTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Estimates under $100 are auto-approved
                  </p>

                  {/* Diagnosis Notes */}
                  <div className="max-w-lg">
                    <label htmlFor="diagnosis-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Diagnosis Notes
                    </label>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-1.5">
                      ⚠ Visible to the customer on the estimate approval page. Keep internal-only commentary out.
                    </p>
                    <textarea
                      id="diagnosis-notes"
                      value={diagnosisNotes}
                      onChange={(e) => setDiagnosisNotes(e.target.value)}
                      rows={3}
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                      placeholder="Describe the issue found (visible to customer)..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-yellow-600 rounded-md hover:bg-yellow-700 disabled:opacity-50 transition-colors min-h-[44px]"
                    >
                      {loading ? 'Submitting...' : 'Submit Estimate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEstimateForm(false)}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Section 5: Parts Requested ── */}
      {(partsRequested.length > 0 || (ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled')) && (
        <Card title={`Parts Requested${partsRequested.length > 0 ? ` (${partsReceivedCount}/${partsRequested.length} received)` : ''}`}>
          {partsRequested.length > 0 && (
            <>
              {allPartsReceived && (
                <div className="mb-3">
                  <Badge label="All Parts Received" classes="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" />
                </div>
              )}
              <div className="space-y-2">
                {partsRequested.map((part, i) => {
                  const statusColors: Record<string, string> = {
                    requested: 'text-yellow-600 dark:text-yellow-400',
                    ordered: 'text-blue-600 dark:text-blue-400',
                    received: 'text-green-600 dark:text-green-400',
                  }
                  return (
                    <div key={i} className="flex flex-col gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${part.cancelled ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{part.description}</span>
                          {part.product_number && isTech && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">#{part.product_number}</span>
                          )}
                          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">x{part.quantity}</span>
                          {part.po_number && isTech && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">PO: {part.po_number}</span>
                          )}
                          {part.cancelled && part.cancel_reason && (
                            <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">Cancelled — {part.cancel_reason}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {part.cancelled ? (
                            <span className="text-xs font-medium uppercase text-red-600 dark:text-red-400">Cancelled</span>
                          ) : (
                            <span className={`text-xs font-medium uppercase ${statusColors[part.status] ?? ''}`}>
                              {part.status}
                            </span>
                          )}
                          {!part.cancelled && isStaff && part.status === 'requested' && (
                            <button
                              onClick={() => handleUpdatePartStatus(i, 'ordered')}
                              disabled={loading || !synergyOrderNumber.trim() || !part.product_number?.trim()}
                              title={
                                !synergyOrderNumber.trim()
                                  ? 'Enter Synergy Order # below first'
                                  : !part.product_number?.trim()
                                  ? 'Enter Synergy item # first'
                                  : undefined
                              }
                              className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                            >
                              Mark Ordered
                            </button>
                          )}
                          {!part.cancelled && isStaff && part.status === 'ordered' && (
                            <button
                              onClick={() => handleUpdatePartStatus(i, 'received')}
                              disabled={loading}
                              className="px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                            >
                              Mark Received
                            </button>
                          )}
                          {!part.cancelled && isManager && (part.status === 'ordered' || part.status === 'received') && (
                            <button
                              onClick={() => handleResetPartStatus(i)}
                              disabled={loading}
                              title={`Reset to ${part.status === 'received' ? 'ordered' : 'requested'}`}
                              className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                            >
                              ↩ Reset
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Synergy item # picker — staff only, required to mark ordered */}
                      {!part.cancelled && isStaff && (
                        <div className="ml-0 sm:ml-4">
                          <PartSynergyPicker
                            productNumber={part.product_number}
                            synergyProductId={part.synergy_product_id ?? null}
                            onChange={(next) => handleSavePartSynergy(i, next)}
                            disabled={loading}
                          />
                        </div>
                      )}

                      {/* Vendor item code — staff only, free text */}
                      {!part.cancelled && isStaff && (
                        <div className="flex items-center gap-2 ml-0 sm:ml-4">
                          <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Vendor item #:</label>
                          <input
                            type="text"
                            value={part.vendor_item_code ?? ''}
                            onChange={(e) => handleUpdatePartVendorItemCode(i, e.target.value)}
                            onBlur={() => handleSavePartVendorItemCode(i)}
                            placeholder="Manufacturer / vendor part #"
                            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-slate-500"
                          />
                        </div>
                      )}

                      {/* PO number input — staff can enter when marking ordered or after */}
                      {!part.cancelled && isStaff && (part.status === 'ordered' || part.status === 'received') && (
                        <div className="flex items-center gap-2 ml-0 sm:ml-4">
                          <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">PO #:</label>
                          <input
                            type="text"
                            value={part.po_number ?? ''}
                            onChange={(e) => handleUpdatePartPo(i, e.target.value)}
                            onBlur={() => handleSavePartPo(i)}
                            placeholder="Enter PO number"
                            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-slate-500"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Add part request — tech or staff */}
          {ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled' && (
            <>
              {!showAddPart ? (
                <button
                  onClick={() => setShowAddPart(true)}
                  className="text-sm font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white py-2 min-h-[44px] flex items-center mt-2"
                >
                  + Request Part
                </button>
              ) : (
                <div className="mt-3 space-y-2 max-w-lg">
                  <input
                    type="text"
                    value={newPartDesc}
                    onChange={(e) => setNewPartDesc(e.target.value)}
                    placeholder="Part description"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      value={newPartQty}
                      onChange={(e) => setNewPartQty(e.target.value)}
                      placeholder="Qty"
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                    <input
                      type="text"
                      value={newPartNumber}
                      onChange={(e) => setNewPartNumber(e.target.value)}
                      placeholder="Synergy item # (optional)"
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                  <input
                    type="text"
                    value={newPartVendorItemCode}
                    onChange={(e) => setNewPartVendorItemCode(e.target.value)}
                    placeholder="Vendor item # (optional)"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddPartRequest}
                      disabled={loading || !newPartDesc.trim()}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
                    >
                      {loading ? 'Adding...' : 'Add Part'}
                    </button>
                    <button
                      onClick={() => { setShowAddPart(false); setNewPartDesc(''); setNewPartQty('1'); setNewPartNumber(''); setNewPartVendorItemCode('') }}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Synergy order # — staff only, shown for any ticket that may need billing */}
          {isStaff && (ticket.status !== 'open' && ticket.status !== 'canceled' && ticket.status !== 'declined') && (
            <SynergyOrderFields
              initialOrder={ticket.synergy_order_number ?? ''}
              onSave={handleSaveSynergyOrderNumber}
              loading={loading}
            />
          )}
        </Card>
      )}

      {/* ── Section 6: Action Buttons ── */}
      <Card title="Actions">
        <div className="space-y-3">
          {/* Open: Start Work (skip estimate for warranty/pre-approved) */}
          {ticket.status === 'open' && (ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty') && (
            <button
              onClick={handleStartWork}
              disabled={loading}
              className="w-full sm:w-auto px-4 py-3 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Starting...' : 'Start Work'}
            </button>
          )}

          {/* Approved: Start Work */}
          {ticket.status === 'approved' && (
            <>
              {partsRequested.length > 0 && !allPartsReceived ? (
                <div className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center">
                  Waiting on parts ({partsReceivedCount}/{partsRequested.length} received)
                </div>
              ) : (
                <button
                  onClick={handleStartWork}
                  disabled={loading}
                  className="w-full sm:w-auto px-4 py-3 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  {loading ? 'Starting...' : 'Start Work'}
                </button>
              )}
            </>
          )}

          {/* In Progress: Complete Ticket */}
          {ticket.status === 'in_progress' && !showCompletionForm && (
            <button
              onClick={() => setShowCompletionForm(true)}
              className="w-full sm:w-auto px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[44px]"
            >
              Complete Ticket
            </button>
          )}

          {/* Completed: Mark Billed (staff only) */}
          {ticket.status === 'completed' && isStaff && (
            <div className="space-y-2">
              {!synergyOrderNumber.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Enter the Synergy Order # in the Parts section above before billing.
                </p>
              )}
              <button
                onClick={handleMarkBilled}
                disabled={loading || !synergyOrderNumber.trim()}
                className="w-full sm:w-auto px-4 py-3 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {loading ? 'Saving...' : 'Mark Billed'}
              </button>
            </div>
          )}

          {/* Inside ticket pickup toggle */}
          {ticket.ticket_type === 'inside' && ticket.status === 'completed' && isStaff && (
            <button
              onClick={handleTogglePickup}
              disabled={loading}
              className={`w-full sm:w-auto px-4 py-3 text-sm font-medium rounded-md transition-colors min-h-[44px] ${
                ticket.picked_up_at
                  ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-600'
                  : ticket.awaiting_pickup
                    ? 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-600'
                    : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              } disabled:opacity-50`}
            >
              {ticket.picked_up_at ? 'Picked Up' : ticket.awaiting_pickup ? 'Awaiting Pickup' : 'Mark Awaiting Pickup'}
            </button>
          )}
        </div>

        {/* Manager actions — always visible */}
        {isManager && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Manager Actions</p>
            <div className="flex flex-wrap gap-2">
              {ticket.status !== 'open' && ticket.status !== 'canceled' && ticket.status !== 'declined' && (
                <button
                  onClick={handleReopen}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
                >
                  Reopen
                </button>
              )}
              {ticket.status !== 'canceled' && (
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
                >
                  Cancel Ticket
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Section 7: Completion Form ── */}
      {ticket.status === 'in_progress' && showCompletionForm && (
        <Card title="Complete Ticket">
          <form onSubmit={handleComplete} className="space-y-5 max-w-xl">
            {/* Hours Worked */}
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
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="0.00"
              />
            </div>

            {/* Parts Used */}
            <PartsEntryList
              parts={completionParts}
              setParts={setCompletionParts}
              showPricing={true}
              showWarranty={ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty'}
              label="Parts Used"
            />

            {/* Billing summary */}
            <div className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3">
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>Labor: {hoursWorked || '0'} hrs x ${laborRate.toFixed(2)}</span>
                  <span>${laborTotal.toFixed(2)}</span>
                </div>
                {completionParts.length > 0 && (
                  <div className="flex justify-between">
                    <span>Parts {ticket.billing_type === 'warranty' ? '(warranty — $0)' : ''}</span>
                    <span>${partsTotal.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-300 dark:border-gray-700">
                <span className="text-base font-bold text-gray-900 dark:text-white">Billing Total</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">${billingTotal.toFixed(2)}</span>
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
                        className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center bg-black/60 text-white rounded-full text-sm hover:bg-black/80"
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

            {/* Completion Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Completion Notes
              </label>
              <textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="Notes about the work performed..."
              />
            </div>

            {/* Customer Signature — not required for inside (shop) tickets */}
            {ticket.ticket_type !== 'inside' && (
              <SignaturePad
                onSignatureChange={({ image, name: sigName }) => {
                  setSignatureImage(image)
                  setSignatureName(sigName)
                }}
              />
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || uploading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Completing...' : 'Mark Complete'}
            </button>
          </form>
        </Card>
      )}

      {/* ── Section 8: Billing Summary (read-only, completed/billed) ── */}
      {(ticket.status === 'completed' || ticket.status === 'billed') && (
        <Card title="Billing Summary">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoField label="Billing Amount">
              {ticket.billing_amount != null ? `$${ticket.billing_amount.toFixed(2)}` : '—'}
            </InfoField>
            <InfoField label="Hours Worked">
              {ticket.hours_worked ?? '—'}
            </InfoField>
            <InfoField label="Labor Total">
              ${((ticket.hours_worked ?? 0) * laborRate).toFixed(2)}
            </InfoField>
            <InfoField label="Parts Total">
              ${(ticket.parts_used ?? []).reduce((sum, p) => sum + (p.warranty_covered ? 0 : p.quantity * p.unit_price), 0).toFixed(2)}
            </InfoField>
            <InfoField label="Synergy Order #">
              {ticket.synergy_order_number ?? '—'}
            </InfoField>
            {ticket.diagnostic_charge != null && (
              <InfoField label="Diagnostic Charge">
                ${ticket.diagnostic_charge.toFixed(2)}
              </InfoField>
            )}
            {ticket.diagnostic_invoice_number && (
              <InfoField label="Diagnostic Invoice #">
                {ticket.diagnostic_invoice_number}
              </InfoField>
            )}
          </div>

          {/* Parts used read-only */}
          {ticket.parts_used && ticket.parts_used.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Parts Used
              </h3>
              <div className="space-y-1">
                {ticket.parts_used.map((part, i) => (
                  <div key={`ro-part-${i}`} className="flex items-center justify-between text-sm">
                    <span className="text-gray-900 dark:text-white">
                      {part.description} x{part.quantity}
                      {part.warranty_covered && (
                        <span className="ml-2 text-xs text-green-600 dark:text-green-400">(Warranty)</span>
                      )}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      ${(part.quantity * part.unit_price).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completion notes */}
          {ticket.completion_notes && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <InfoField label="Completion Notes">
                <span className="font-normal whitespace-pre-wrap">{ticket.completion_notes}</span>
              </InfoField>
            </div>
          )}

          {/* Photos */}
          {ticket.photos && ticket.photos.length > 0 && (
            <ReadOnlyPhotos photos={ticket.photos} />
          )}

          {/* Signature */}
          {ticket.customer_signature_name && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <InfoField label="Customer Signature">
                {ticket.customer_signature_name}
              </InfoField>
            </div>
          )}
        </Card>
      )}

      {/* Completion details for techs (no billing) */}
      {(ticket.status === 'completed' || ticket.status === 'billed') && isTech && (
        <Card title="Completion Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoField label="Hours Worked">
              {ticket.hours_worked ?? '—'}
            </InfoField>
            <InfoField label="Completed">
              {ticket.completed_at ? new Date(ticket.completed_at).toLocaleDateString() : '—'}
            </InfoField>
          </div>
          {ticket.completion_notes && (
            <div className="mt-3">
              <InfoField label="Completion Notes">
                <span className="font-normal whitespace-pre-wrap">{ticket.completion_notes}</span>
              </InfoField>
            </div>
          )}
          {ticket.parts_used && ticket.parts_used.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Parts Used
              </h3>
              <div className="space-y-1">
                {ticket.parts_used.map((part, i) => (
                  <div key={`tech-part-${i}`} className="text-sm text-gray-900 dark:text-white">
                    {part.description} x{part.quantity}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ── Sub-components ──

function SynergyOrderFields({
  initialOrder,
  onSave,
  loading,
}: {
  initialOrder: string
  onSave: (order: string) => Promise<void>
  loading: boolean
}) {
  const [order, setOrder] = useState(initialOrder)
  const [dirty, setDirty] = useState(false)

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wide">Synergy Ordering</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Order #</label>
          <input
            type="text"
            value={order}
            onChange={(e) => { setOrder(e.target.value); setDirty(true) }}
            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        {dirty && (
          <button
            onClick={() => { onSave(order); setDirty(false) }}
            disabled={loading}
            className="self-end px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Save
          </button>
        )}
      </div>
    </div>
  )
}
