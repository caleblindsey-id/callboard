'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import UnblockCreditPanel from '@/components/UnblockCreditPanel'
import SignaturePad from '@/components/SignaturePad'
import ReadOnlyPhotos from '@/components/ReadOnlyPhotos'
import PartsEntryList, { PartEntry, emptyPart, partsFromSaved, toServicePartUsed } from '@/components/service/PartsEntryList'
import { partLabel, partsOnOrder } from '@/lib/parts'
import { formatDate } from '@/lib/format'
import PartSynergyPicker from '@/components/PartSynergyPicker'
import VendorPicker from '@/components/VendorPicker'
import { useProductSearch, type ProductSearchResult } from '@/lib/hooks/useProductSearch'
import WorkflowStatusCard from '@/components/WorkflowStatusCard'
import CompletionSuccessDialog from '@/components/CompletionSuccessDialog'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import { getPublicAppUrl } from '@/lib/urls'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import RegisterEquipmentPanel from './RegisterEquipmentPanel'
import TechEquipmentDetailsPanel from './TechEquipmentDetailsPanel'
import VerifyEquipmentPanel from '@/components/VerifyEquipmentPanel'
import { equipmentNeedsVerification, equipmentReadyForParts } from '@/lib/equipment'
import DiagnosticFeeCard from './DiagnosticFeeCard'
import ChangeLocationSection from '@/app/tickets/[id]/ChangeLocationSection'
import type {
  ServiceTicketDetail as ServiceTicketDetailType,
  ServiceTicketStatus,
  ServiceBillingType,
  PartRequest,
  ServicePartUsed,
} from '@/types/service-tickets'
import type { UserRole, UserRow, TicketPhoto } from '@/types/database'

// ── Types ──

interface ServiceTicketDetailProps {
  ticket: ServiceTicketDetailType
  userRole: UserRole | null
  userId: string
  laborRate: number
  laborRates: Record<string, number>
  tripChargeRate: number
  // Estimated arrival dates for ordered parts, keyed `${po_number}|${product_number}`.
  // Looked up server-side from Synergy's open PO lines (getPoDueDates). Absent
  // key = part isn't on an open PO, so nothing is shown.
  poDueDates?: Record<string, string>
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

// ── Workflow card helpers ───────────────────────────────────────────────────
// User-facing labels for each status. Mirrors page.tsx STEP_LABELS but
// includes the off-rail states (declined/canceled) too.
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  estimated: 'Awaiting Approval',
  approved: 'Approved',
  in_progress: 'In Progress',
  completed: 'Completed',
  billed: 'Billed',
  declined: 'Declined',
  canceled: 'Canceled',
}

interface WorkflowComputeArgs {
  status: ServiceTicketStatus
  isManager: boolean
  isTech: boolean
  isStaff: boolean
  partsWaiting: number
  partsTotal: number
  requestInfoNote: string | null
  estimateApproved: boolean
}

/**
 * Compute the {state, nextActor, blocker} props for the WorkflowStatusCard.
 * The pre-approval state is `open`; "Awaiting Approval" is `estimated`.
 *
 * `blocker` surfaces when something external (parts not in, request-info
 * note pending) is preventing the next state transition.
 */
function computeWorkflowProps({
  status,
  isManager,
  isTech,
  isStaff,
  partsWaiting,
  partsTotal,
  requestInfoNote,
  estimateApproved,
}: WorkflowComputeArgs): { state: string; nextActor?: string; blocker?: string } {
  const label = STATUS_LABELS[status] ?? status
  let nextActor: string | undefined
  let blocker: string | undefined

  switch (status) {
    case 'open':
      if (requestInfoNote) {
        nextActor = isTech ? 'Tech revises estimate' : 'Tech updating estimate'
        blocker = 'Manager requested more info'
      } else {
        nextActor = isTech ? 'Build the estimate' : 'Tech to build estimate'
      }
      break
    case 'estimated':
      nextActor = isStaff
        ? 'Manager to approve, decline, or request info'
        : 'Awaiting customer / manager approval'
      break
    case 'approved':
      if (partsTotal > 0 && partsWaiting > 0) {
        nextActor = isStaff ? 'Order parts, then start work' : 'Tech starts work once parts arrive'
        blocker = `Waiting on parts (${partsWaiting} of ${partsTotal} still pending)`
      } else {
        nextActor = isTech ? 'Start work' : 'Tech to start work'
      }
      break
    case 'in_progress':
      nextActor = isTech ? 'Complete the job' : 'Tech completing work'
      break
    case 'completed':
      nextActor = isStaff ? 'Bill in Synergy' : 'Office to bill'
      break
    case 'billed':
      nextActor = undefined
      break
    case 'declined':
      nextActor = estimateApproved
        ? undefined
        : isManager ? 'Reopen and revise the estimate' : 'Manager review'
      break
    case 'canceled':
      nextActor = undefined
      break
  }

  return { state: label, nextActor, blocker }
}

// ── Request More Info modal ────────────────────────────────────────────────

interface RequestInfoModalProps {
  open: boolean
  initialDraft?: string
  busy: boolean
  onSubmit: (note: string) => void
  onCancel: () => void
}

function RequestInfoModal({ open, initialDraft, busy, onSubmit, onCancel }: RequestInfoModalProps) {
  // Parent remounts this via the `key={open}` prop, so initialDraft only
  // needs to seed state once. Avoids setState-in-effect cascading renders.
  const [note, setNote] = useState(initialDraft ?? '')

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request more info"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Request More Info
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            This sends the estimate back to the tech and shows your note when they reopen the ticket.
          </p>
        </div>
        <div className="p-5">
          <label htmlFor="request-info-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            What do you need from the tech? <span className="text-red-600">*</span>
          </label>
          <textarea
            id="request-info-note"
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            maxLength={2000}
            className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {note.length} / 2000
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note.trim())}
            disabled={busy || note.trim().length < 2}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {busy ? 'Sending...' : 'Send Back to Tech'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bypass-estimate (pre-authorized work) modal ────────────────────────────

interface BypassEstimateModalProps {
  open: boolean
  busy: boolean
  onSubmit: (note: string) => void
  onCancel: () => void
}

function BypassEstimateModal({ open, busy, onSubmit, onCancel }: BypassEstimateModalProps) {
  // Parent remounts via `key={open}` so the field starts empty each time.
  const [note, setNote] = useState('')

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start work without an estimate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Start work — no estimate
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Skips the estimate and starts the repair now. Use only when work is already authorized.
          </p>
        </div>
        <div className="p-5">
          <label htmlFor="bypass-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Who authorized starting work? <span className="text-red-600">*</span>
          </label>
          <textarea
            id="bypass-note"
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. Approved by Jane Doe on site 6/12 — repair pre-authorized on PO 4471"
            className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {note.length} / 2000
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note.trim())}
            disabled={busy || note.trim().length < 2}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {busy ? 'Starting...' : 'Start Work'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Quick Complete bottom sheet (mobile) ───────────────────────────────────

interface QuickCompleteSheetProps {
  open: boolean
  busy: boolean
  signatureRequired: boolean
  onCancel: () => void
  onSubmit: (data: { hours: number; notes: string; signatureImage: string | null; signatureName: string }) => void
}

function QuickCompleteSheet({ open, busy, signatureRequired, onCancel, onSubmit }: QuickCompleteSheetProps) {
  // Parent uses `key={open}` to remount this on toggle so a fresh form is
  // guaranteed without setState-in-effect cascades.
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [sigImage, setSigImage] = useState<string | null>(null)
  const [sigName, setSigName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const submit = () => {
    const h = parseFloat(hours)
    if (!Number.isFinite(h) || h <= 0) {
      setError('Enter hours worked.')
      return
    }
    if (signatureRequired && (!sigImage || !sigName.trim())) {
      setError('Customer signature and printed name are required.')
      return
    }
    setError(null)
    onSubmit({ hours: h, notes: notes.trim(), signatureImage: sigImage, signatureName: sigName.trim() })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick complete"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full sm:max-w-md sm:rounded-lg rounded-t-2xl bg-white dark:bg-gray-800 border-t sm:border border-gray-200 dark:border-gray-700 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Quick Complete</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2"
          >
            &times;
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
          <div>
            <label htmlFor="qc-hours" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Hours worked
            </label>
            <input
              id="qc-hours"
              type="number"
              inputMode="decimal"
              step="0.25"
              min="0"
              autoFocus
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 text-base w-full focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[44px]"
              placeholder="0.00"
            />
          </div>
          <div>
            <label htmlFor="qc-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Completion notes
            </label>
            <textarea
              id="qc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 text-base w-full focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="What you fixed..."
            />
          </div>
          {signatureRequired && (
            <SignaturePad
              onSignatureChange={({ image, name: sigPrinted }) => {
                setSigImage(image)
                setSigName(sigPrinted)
              }}
            />
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full px-4 py-3 text-base font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[48px]"
          >
            {busy ? 'Completing...' : 'Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Section accordion wrapper ──────────────────────────────────────────────
// Uses uncontrolled <details> with a key so changes to `open` re-render the
// element rather than fighting the browser's internal state. The `title` is
// rendered as an h2 inside the <summary> so the section keeps its visual
// hierarchy when collapsed.

function CardSection({
  title,
  open,
  summarySuffix,
  children,
}: {
  title: string
  open: boolean
  summarySuffix?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <details key={open ? 'open' : 'closed'} open={open}>
        <summary className="px-5 py-4 cursor-pointer select-none flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 marker:content-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide truncate">
              {title}
            </h2>
            {summarySuffix && <span className="shrink-0">{summarySuffix}</span>}
          </div>
          <svg className="h-4 w-4 text-gray-400 dark:text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="p-5">{children}</div>
      </details>
    </div>
  )
}

export function ServiceTicketDetail({ ticket, userRole, userId, laborRate, laborRates, tripChargeRate, poDueDates = {} }: ServiceTicketDetailProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'
  const isManager = userRole === 'super_admin' || userRole === 'manager'
  const isStaff = !isTech && userRole !== null

  // --- State ---
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Technician assign/reassign (staff only). Active techs loaded client-side,
  // mirroring the create form (CreateServiceTicketForm).
  const [technicians, setTechnicians] = useState<UserRow[]>([])
  const [assignedTechId, setAssignedTechId] = useState(ticket.assigned_technician_id ?? '')
  // Staff-editable billing type (warranty / non-warranty). The badge above shows
  // it at a glance; staff can correct a mis-keyed ticket here (API already allows
  // billing_type in STAFF_ALLOWED_FIELDS). Techs use the completion-form confirm.
  const [billingType, setBillingType] = useState<ServiceBillingType>(ticket.billing_type)
  useEffect(() => {
    if (!isStaff) return
    createClient()
      .from('users')
      .select('*')
      .eq('active', true)
      .eq('role', 'technician')
      .order('name')
      .then(({ data }) => {
        if (data) setTechnicians(data)
      })
  }, [isStaff])
  useEffect(() => {
    setAssignedTechId(ticket.assigned_technician_id ?? '')
  }, [ticket.assigned_technician_id])

  // Estimate form
  const [showEstimateForm, setShowEstimateForm] = useState(false)
  const [estimateRateType, setEstimateRateType] = useState(ticket.labor_rate_type ?? 'standard')
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
  const [newPartVendor, setNewPartVendor] = useState('')
  const [newPartVendorCode, setNewPartVendorCode] = useState('')
  const [newPartPrice, setNewPartPrice] = useState('')
  // Set when the description is matched to a Synergy catalog item — links the
  // request to the product (exempts it from the manual vendor/price gate) and
  // prefills item #, price, vendor, and vendor part # from the catalog.
  const [newPartSynergyProductId, setNewPartSynergyProductId] = useState<number | null>(null)
  // Debounced product search backing the "Part description" combobox. Extended
  // select includes vendor_code/vendor/vendor_item_code (migration 091) for prefill.
  const partSearch = useProductSearch({ limit: 10 })
  const setPartComboOpen = partSearch.setComboOpen
  const partComboRef = useRef<HTMLDivElement | null>(null)

  // Completion form
  const [showCompletionForm, setShowCompletionForm] = useState(false)
  const [hoursWorked, setHoursWorked] = useState(
    ticket.hours_worked != null ? String(ticket.hours_worked) : ''
  )
  const [completionNotes, setCompletionNotes] = useState(ticket.completion_notes ?? '')
  // Optional equipment service-life capture (parity with PM completion).
  const [machineHours, setMachineHours] = useState(
    ticket.machine_hours != null ? String(ticket.machine_hours) : ''
  )
  const [dateCode, setDateCode] = useState(ticket.date_code ?? '')
  const [completionParts, setCompletionParts] = useState<PartEntry[]>(
    ticket.parts_used && ticket.parts_used.length > 0
      ? partsFromSaved(ticket.parts_used)
      : []
  )
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')

  // ACE labor — tech-payout labor on no-charge work, captured at completion.
  const [aceLaborOpen, setAceLaborOpen] = useState(false)
  const [aceHours, setAceHours] = useState('')
  const [aceReason, setAceReason] = useState('')

  // Photos
  const [photos, setPhotos] = useState<Array<TicketPhoto & { previewUrl?: string }>>(
    ticket.photos && ticket.photos.length > 0 ? ticket.photos : []
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Billing / Synergy. Two distinct numbers: the order # is the parts-ordering
  // reference (ERP-validated, set during the job); the invoice # is the billing
  // gate (set at billing to mark the ticket 'billed').
  const [synergyOrderNumber, setSynergyOrderNumber] = useState(ticket.synergy_order_number ?? '')
  const [synergyInvoiceNumber, setSynergyInvoiceNumber] = useState(ticket.synergy_invoice_number ?? '')
  const [diagnosticCharge, setDiagnosticCharge] = useState(
    ticket.diagnostic_charge != null ? String(ticket.diagnostic_charge) : ''
  )
  const [diagnosticInvoiceNumber, setDiagnosticInvoiceNumber] = useState(
    ticket.diagnostic_invoice_number ?? ''
  )
  // Trip charge = number of trips × the per-trip rate (mirrors labor hours × rate).
  // Opt-in: seed the saved per-ticket qty, else leave the field BLANK so no trip
  // charge is added unless someone enters a quantity. Billed dollar = qty × rate.
  const [tripChargeQty, setTripChargeQty] = useState(
    ticket.trip_charge_qty != null ? String(ticket.trip_charge_qty) : ''
  )

  // Equipment registration (for tickets with denormalized equipment fields)
  const [registeringEquipment, setRegisteringEquipment] = useState(false)

  // Auto-save (in-progress completion fields) — mirrors the PM pattern in
  // src/app/tickets/[id]/TicketActions.tsx (saveProgress + 3s debounce).
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)
  const flushRef = useRef<() => void>(() => {})

  // Customer PO # — techs and staff can record the customer's purchase order
  // number on the ticket. The PO often arrives while the tech is on-site
  // mid-repair (feedback #38). Explicit Save (not auto-save) so an in-app nav
  // can't drop an unsaved edit.
  const [poNumber, setPoNumber] = useState(ticket.po_number ?? '')
  const [poSaved, setPoSaved] = useState(!!ticket.po_number)
  const [poSaving, setPoSaving] = useState(false)

  // Contact edit state — staff can update name/email/phone after submission
  const [editingContact, setEditingContact] = useState(false)
  const [contactDraftName, setContactDraftName] = useState(ticket.contact_name ?? '')
  const [contactDraftEmail, setContactDraftEmail] = useState(ticket.contact_email ?? '')
  const [contactDraftPhone, setContactDraftPhone] = useState(ticket.contact_phone ?? '')

  // Request More Info modal (manager-side, on Awaiting Approval state)
  const [requestInfoOpen, setRequestInfoOpen] = useState(false)
  // Bypass-estimate (pre-authorized work) modal — non-warranty open tickets
  const [bypassOpen, setBypassOpen] = useState(false)
  // Log-call inline form on the estimate card (estimated-state customer follow-up)
  const [estimateCallOpen, setEstimateCallOpen] = useState(false)
  const [estimateCallNotes, setEstimateCallNotes] = useState('')

  // Quick Complete bottom sheet (mobile, in_progress + viewer is assigned tech)
  const [quickCompleteOpen, setQuickCompleteOpen] = useState(false)
  // Post-completion confirmation popup ("where to next")
  const [completed, setCompleted] = useState(false)
  // Set once the tech verifies the unit this session, for instant UI feedback
  // ahead of the router.refresh() that re-fetches details_verified_at.
  const [equipmentJustVerified, setEquipmentJustVerified] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Refs to the estimate / completion cards so opening a form from the Next
  // Step bar (top or mobile sticky) scrolls it into view — on a phone the
  // trigger can sit a full screen away from the form.
  const estimateCardRef = useRef<HTMLDivElement>(null)
  const completionCardRef = useRef<HTMLDivElement>(null)

  // Track mobile viewport so the mobile sticky action bar / quick-complete
  // sheet only render on small screens. Runs after mount to avoid SSR mismatch.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 640px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Close the "Part description" product-search dropdown on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (partComboRef.current && !partComboRef.current.contains(e.target as Node)) {
        setPartComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [setPartComboOpen])

  // Scroll the relevant form into view when opened from a Next Step action.
  useEffect(() => {
    if (showEstimateForm) {
      estimateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [showEstimateForm])
  useEffect(() => {
    if (showCompletionForm) {
      completionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [showCompletionForm])

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
        // Staff-only field — server re-resolves and snapshots estimate_labor_rate from it.
        ...(isStaff ? { labor_rate_type: estimateRateType } : {}),
        // Trip charge qty lives inline under labor hours; persist it with the estimate.
        ...(isStaff ? { trip_charge_qty: parseFloat(tripChargeQty) || 0 } : {}),
      })
      if (result.status === SERVICE_STATUS.APPROVED) {
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

  async function handleRequestMoreInfo(note: string) {
    await apiAction(async () => {
      const res = await fetch(`/api/service-tickets/${ticket.id}/request-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send back to tech')
      }
      setRequestInfoOpen(false)
      setSuccessMsg('Sent back to tech with your note.')
    })
  }

  async function handleReopenEstimate() {
    if (!confirm(
      'Reopen this estimate for editing? The customer’s approval/signature ' +
      'will be cleared and you’ll need to re-send it for approval. ' +
      'The estimate numbers are kept.'
    )) return
    await apiAction(async () => {
      const res = await fetch(`/api/service-tickets/${ticket.id}/reopen-estimate`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reopen estimate')
      }
      setSuccessMsg('Estimate reopened for editing.')
    })
  }

  // Logs an office phone-contact attempt on the estimate (counts as first
  // contact alongside emailing it). Mirrors the estimate follow-up queue action.
  async function handleLogEstimateCall() {
    await apiAction(async () => {
      const res = await fetch(`/api/service-tickets/${ticket.id}/mark-estimate-contacted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: estimateCallNotes.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to log the call')
      }
      setEstimateCallOpen(false)
      setEstimateCallNotes('')
      setSuccessMsg('Call logged.')
    })
  }

  async function handleQuickComplete({
    hours,
    notes,
    signatureImage,
    signatureName,
  }: {
    hours: number
    notes: string
    signatureImage: string | null
    signatureName: string
  }) {
    await apiAction(async () => {
      // Persist a warranty correction before completing — the /complete route
      // recomputes billing from the STORED billing_type, so it must be saved
      // first for the $0 math to apply.
      if (billingType !== ticket.billing_type) {
        await patchTicket({ billing_type: billingType })
      }
      const res = await fetch(`/api/service-tickets/${ticket.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_at: new Date().toISOString(),
          hours_worked: hours,
          parts_used: [],
          completion_notes: notes || null,
          customer_signature: signatureImage,
          customer_signature_name: signatureName || null,
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          ace_labor: null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to complete ticket')
      }
      setQuickCompleteOpen(false)
      setCompleted(true)
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

  async function handleDownloadWorkOrder() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}/work-order-pdf`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to generate work order PDF')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'work-order.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download work order')
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

  async function handleSavePoNumber() {
    setPoSaving(true)
    setError(null)
    try {
      await patchTicket({ po_number: poNumber.trim() || null })
      setPoSaved(!!poNumber.trim())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save PO number')
    } finally {
      setPoSaving(false)
    }
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
      // PATCH returns the full updated row. On the approved -> in_progress
      // transition the server prefills the work order from the approved
      // estimate (parts, hours, diagnosis -> completion notes), so hydrate the
      // already-mounted form state from the response — the useState seeds at
      // mount captured the empty `approved`-state values and won't re-run.
      // These setState calls run before router.refresh(), while ticket.status
      // is still 'approved', so the auto-save effect early-returns on its
      // status check and no spurious write-back fires.
      const updated = await patchTicket({ status: 'in_progress' })
      if (updated) {
        setCompletionParts(
          updated.parts_used && updated.parts_used.length > 0
            ? partsFromSaved(updated.parts_used)
            : []
        )
        setHoursWorked(updated.hours_worked != null ? String(updated.hours_worked) : '')
        setCompletionNotes(updated.completion_notes ?? '')
      }
    })
  }

  // Pre-authorized work: start the repair straight from 'open' with no
  // estimate, recording who authorized it. The server requires the note,
  // flags estimate_bypassed, and marks the estimate approved.
  async function handleBypassEstimate(note: string) {
    await apiAction(async () => {
      await patchTicket({ status: 'in_progress', manual_decision_note: note })
      setBypassOpen(false)
    })
  }

  // ── Auto-save (in-progress completion fields) ──
  // Mirrors src/app/tickets/[id]/TicketActions.tsx saveProgress / debounce
  // pattern. PATCHes the same fields techs can update mid-job so a refresh
  // or in-app nav doesn't drop their work.
  async function saveProgress(opts?: { keepalive?: boolean }) {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: opts?.keepalive ?? false,
        body: JSON.stringify({
          hours_worked: parseFloat(hoursWorked) || null,
          completion_notes: completionNotes || null,
          parts_used: completionParts.length > 0 ? toServicePartUsed(completionParts) : [],
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          // Trip charge qty lives inline under Hours Worked; persist staff edits so
          // a refresh doesn't drop them (server filters it out for techs).
          ...(isStaff ? { trip_charge_qty: parseFloat(tripChargeQty) || 0 } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
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

  // Auto-save: debounce 3 seconds after any completion-form field change
  // while the ticket is in_progress.
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
  }, [hoursWorked, completionNotes, completionParts, photos])

  // Keep the unmount-flush closure pointing at the latest state.
  useEffect(() => {
    flushRef.current = () => {
      if (!autoSaveTimer.current) return
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
      void saveProgress({ keepalive: true })
    }
  })

  // Flush any pending debounce on unmount (in-app nav).
  useEffect(() => () => flushRef.current(), [])

  // Warn on hard navigation while a save is pending.
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

  async function handleRequestEstimatePart(index: number) {
    const entry = estimateParts[index]
    if (!entry || !entry.description.trim() || entry.alreadyRequested) return
    const priceParsed = parseFloat(entry.unitPrice)
    const newPart: PartRequest = {
      description: entry.description.trim(),
      quantity: Number(entry.quantity) || 1,
      product_number: entry.productNumber?.trim() || undefined,
      synergy_product_id: entry.synergyProductId ?? undefined,
      vendor_item_code: entry.vendorItemCode?.trim() || undefined,
      vendor: entry.vendor?.trim() || undefined,
      vendor_code: entry.vendorCode?.trim() || undefined,
      unit_price:
        entry.unitPrice.trim() !== '' && Number.isFinite(priceParsed) ? priceParsed : undefined,
      // New requests enter the office Review step (stock-vs-order triage) before
      // the To-Order queue. Service parts stay hidden until the estimate is approved.
      status: 'pending_review',
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

  // The machine must be identified before any part request so the office knows
  // what it's for. Shared with the server machine gate via equipmentReadyForParts:
  // a LINKED unit is ready once tech-verified (make+model+verified, serial
  // optional — the verify panel below is how the tech does this); an inline-only
  // ticket falls back to make/model/serial field presence.
  const machineComplete = equipmentReadyForParts({
    inlineMake: ticket.equipment_make,
    inlineModel: ticket.equipment_model,
    inlineSerial: ticket.equipment_serial_number,
    linked: ticket.equipment ?? null,
  })

  // A catalog part (matched to a Synergy product) resolves vendor + price
  // office-side, so it's exempt from the manual gate — mirrors the server-side
  // validateNewManualPartRequests exemption. A manual (off-catalog) part can't
  // be backfilled, so vendor name, vendor part #, description, and a customer
  // price are all required.
  const newPartIsCatalog = newPartSynergyProductId != null
  const newPartPriceParsed = parseFloat(newPartPrice)
  const newPartPriceValid =
    newPartPrice.trim() !== '' && Number.isFinite(newPartPriceParsed) && newPartPriceParsed >= 0
  const addPartReady = newPartIsCatalog
    ? !!newPartDesc.trim()
    : !!newPartDesc.trim() &&
      !!newPartVendor.trim() &&
      !!newPartVendorItemCode.trim() &&
      newPartPriceValid

  // Prefill the request from a picked Synergy catalog item: description, item #,
  // price, vendor (+ vendor_code), and vendor part #. Locks the description to a
  // chip until cleared. Loaded cost is never fetched — tech-facing search omits it.
  function selectCatalogPart(p: ProductSearchResult) {
    const synergyId = Number(p.synergy_id)
    setNewPartSynergyProductId(Number.isFinite(synergyId) ? synergyId : null)
    setNewPartDesc(p.description?.trim() || p.number)
    setNewPartNumber(p.number)
    setNewPartPrice(p.unit_price != null ? String(p.unit_price) : '')
    setNewPartVendor(p.vendor ?? '')
    setNewPartVendorCode(p.vendor_code != null ? String(p.vendor_code) : '')
    setNewPartVendorItemCode(p.vendor_item_code ?? '')
    partSearch.clear()
  }

  // Unlink the catalog item and reset every prefilled field back to manual entry.
  function clearCatalogPart() {
    setNewPartSynergyProductId(null)
    setNewPartDesc('')
    setNewPartNumber('')
    setNewPartPrice('')
    setNewPartVendor('')
    setNewPartVendorCode('')
    setNewPartVendorItemCode('')
    partSearch.clear()
  }

  function resetAddPartForm() {
    setShowAddPart(false)
    setNewPartDesc('')
    setNewPartQty('1')
    setNewPartNumber('')
    setNewPartVendorItemCode('')
    setNewPartVendor('')
    setNewPartVendorCode('')
    setNewPartPrice('')
    setNewPartSynergyProductId(null)
    partSearch.clear()
  }

  async function handleAddPartRequest() {
    if (!addPartReady) return
    const newPart: PartRequest = {
      description: newPartDesc.trim(),
      quantity: parseInt(newPartQty) || 1,
      product_number: newPartNumber.trim() || undefined,
      synergy_product_id: newPartSynergyProductId ?? undefined,
      vendor_item_code: newPartVendorItemCode.trim() || undefined,
      vendor: newPartVendor.trim() || undefined,
      vendor_code: newPartVendorCode.trim() || undefined,
      unit_price: newPartPriceValid ? newPartPriceParsed : undefined,
      // New requests enter the office Review step (stock-vs-order triage) first.
      status: 'pending_review',
      requested_at: new Date().toISOString(),
    }
    const updatedParts = [...partsRequested, newPart]
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedParts })
      setPartsRequested(updatedParts)
      resetAddPartForm()
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

  async function handleSaveSynergyInvoiceNumber(synergyInvoice: string) {
    await apiAction(async () => {
      await patchTicket({
        synergy_invoice_number: synergyInvoice || null,
      })
      setSynergyInvoiceNumber(synergyInvoice)
    })
  }

  function handleEquipmentVerified() {
    setEquipmentJustVerified(true)
    setError(null)
    // Re-fetch so details_verified_at (and the rest of the ticket) is current.
    router.refresh()
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault()

    if (needsEquipmentVerify) {
      setError('Verify the equipment details above before completing.')
      return
    }

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

    await apiAction(async () => {
      // Persist a warranty correction before completing — the /complete route
      // recomputes billing from the STORED billing_type, so it must be saved
      // first for the $0 math to apply.
      if (billingType !== ticket.billing_type) {
        await patchTicket({ billing_type: billingType })
      }
      const res = await fetch(`/api/service-tickets/${ticket.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_at: new Date().toISOString(),
          hours_worked: hours,
          trip_charge_qty: parseFloat(tripChargeQty) || 0,
          parts_used: toServicePartUsed(completionParts),
          completion_notes: completionNotes || null,
          machine_hours: machineHours.trim() !== '' ? parseFloat(machineHours) : null,
          date_code: dateCode.trim() || null,
          customer_signature: signatureImage || null,
          customer_signature_name: signatureName.trim() || null,
          photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
          ace_labor: aceLaborOpen && parseFloat(aceHours) > 0
            ? { hours: parseFloat(aceHours), reason: aceReason.trim() }
            : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to complete ticket')
      }
      setCompleted(true)
    })
  }

  async function handleMarkBilled() {
    if (!synergyInvoiceNumber.trim()) {
      setError('Synergy invoice number is required to mark as billed')
      return
    }
    await apiAction(async () => {
      await patchTicket({
        status: 'billed',
        synergy_invoice_number: synergyInvoiceNumber.trim(),
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
    // Reopen from a worked state (in_progress/completed/billed) on a ticket
    // whose estimate was already approved drops back to 'approved' so the
    // estimate + approval survive and only completion data is cleared.
    // Everything else (declined-revise, canceled, or worked tickets without
    // an approved estimate) keeps the original wipe-to-'open' behavior.
    const reopenToApproved =
      ticket.estimate_approved &&
      (ticket.status === SERVICE_STATUS.IN_PROGRESS ||
        ticket.status === SERVICE_STATUS.COMPLETED ||
        ticket.status === SERVICE_STATUS.BILLED)
    const message = reopenToApproved
      ? 'Reopen this ticket? Completion data will be cleared. The estimate and approval will be kept.'
      : 'Reopen this ticket? Completion data will be cleared.'
    if (!confirm(message)) return
    await apiAction(async () => {
      await patchTicket({ status: reopenToApproved ? 'approved' : 'open' })
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

  // Cancelled parts drop out of the waiting/ready calculation — they
  // remain visible (struck-through) but don't count toward the denominator.
  // Mirrors the server-side parts_received derivation in
  // api/parts-queue/update/route.ts and api/service-tickets/[id]/route.ts.
  const livePartsRequested = partsRequested.filter((p) => !p.cancelled)
  // 'from_stock' (pulled in-house) counts as fulfilled, same as 'received' —
  // single source of truth via partsOnOrder(), matching the server-side
  // parts_received derivation. A from_stock part never becomes 'received', so
  // counting received-only left the ticket stuck "Waiting on parts 1 of 1".
  const partsWaitingCount = partsOnOrder(partsRequested).length
  const partsReceivedCount = livePartsRequested.length - partsWaitingCount
  const allPartsReceived = livePartsRequested.length > 0 && partsWaitingCount === 0
  const partsTotal = completionParts
    .filter((p) => !p.warrantyCovered)
    .reduce((sum, p) => sum + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0), 0)
  const laborTotal = (parseFloat(hoursWorked) || 0) * laborRate
  // Trip charge billed (0 on full-warranty tickets, matching the server).
  // Billed trip charge = trips × per-trip rate (0 on full-warranty tickets).
  const tripChargeQtyNum = parseFloat(tripChargeQty) || 0
  const tripChargeNum = ticket.billing_type === 'warranty' ? 0 : tripChargeQtyNum * tripChargeRate
  const billingTotal = ticket.billing_type === 'warranty' ? 0 : laborTotal + partsTotal + tripChargeNum

  // Estimate computed totals. The rate type can be re-picked in the builder, so the
  // preview uses the resolved rate for the selected type (server re-snapshots on submit).
  const effectiveEstRate = laborRates?.[estimateRateType] ?? laborRate
  const estLaborTotal = (parseFloat(estimateLaborHours) || 0) * effectiveEstRate
  const estPartsTotal = estimateParts
    .filter((p) => !p.warrantyCovered)
    .reduce((sum, p) => sum + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0), 0)
  const estTotal = ticket.billing_type === 'warranty' ? 0 : estLaborTotal + estPartsTotal + tripChargeNum

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

  // Equipment-details gate (mirrors the server gate in /complete): a tech must
  // enter/verify make/model/serial on the linked equipment before completing.
  // Verify-once — skips for already-verified units and equipment-less tickets.
  const equipmentToVerify =
    !equipmentJustVerified && ticket.equipment && equipmentNeedsVerification(ticket.equipment)
      ? ticket.equipment
      : null
  const needsEquipmentVerify = equipmentToVerify !== null

  // (Render helpers moved outside component — see Badge, Card, InfoField above)

  // Workflow card props — derived from current state + parts queue.
  // (partsWaitingCount computed above with the other parts totals.)
  const workflowProps = computeWorkflowProps({
    status: ticket.status,
    isManager,
    isTech,
    isStaff,
    partsWaiting: partsWaitingCount,
    partsTotal: livePartsRequested.length,
    requestInfoNote: ticket.request_info_note,
    estimateApproved: ticket.estimate_approved,
  })

  // Accordion default-open logic:
  //  - estimating (open status, no request-info): estimate section open
  //  - awaiting_approval (estimated): estimate read-only, expanded for review
  //  - approved/in_progress: completion open
  //  - completed/billed: both closed (summary already shown above)
  // On viewports ≤ 640px, only the section matching the *current* action is open;
  // other sections collapse so the tech doesn't have to scroll past them.
  const estimateOpenDefault = ticket.status === SERVICE_STATUS.OPEN ||
    ticket.status === SERVICE_STATUS.ESTIMATED ||
    ticket.status === SERVICE_STATUS.DECLINED
  const completionOpenDefault = ticket.status === SERVICE_STATUS.APPROVED ||
    ticket.status === SERVICE_STATUS.IN_PROGRESS
  // On mobile, only the section that matches the current state is open.
  const estimateOpen = isMobile
    ? (ticket.status === SERVICE_STATUS.OPEN || ticket.status === SERVICE_STATUS.ESTIMATED || ticket.status === SERVICE_STATUS.DECLINED)
    : estimateOpenDefault
  const completionOpen = isMobile
    ? (ticket.status === SERVICE_STATUS.APPROVED || ticket.status === SERVICE_STATUS.IN_PROGRESS)
    : completionOpenDefault

  const quickCompleteEligible =
    ticket.status === SERVICE_STATUS.IN_PROGRESS &&
    isTech &&
    ticket.assigned_technician_id === userId &&
    // When the unit still needs verification, Quick Complete can't run — the
    // tech is routed to the full form, which surfaces the verify panel.
    !needsEquipmentVerify

  const signatureRequired = ticket.ticket_type !== 'inside'

  // ── Next Step bar ──
  // One contextual primary action per stage, surfaced at the top so the
  // viewer never hunts for "what's next". The same booleans gate the bar's
  // visibility AND suppress the WorkflowStatusCard "Next:" line when the
  // viewer has a button (so we don't show "Next: Build the estimate" right
  // above a "Build Estimate" button).
  const partsBlocking = livePartsRequested.length > 0 && !allPartsReceived
  const isWarrantyOpen =
    ticket.status === SERVICE_STATUS.OPEN &&
    (ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty')
  const viewerHasPrimaryAction =
    isWarrantyOpen ||
    (ticket.status === SERVICE_STATUS.OPEN && !showEstimateForm) ||
    (ticket.status === SERVICE_STATUS.ESTIMATED && isStaff) ||
    (ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking) ||
    (ticket.status === SERVICE_STATUS.IN_PROGRESS && !showCompletionForm) ||
    (ticket.status === SERVICE_STATUS.COMPLETED && isStaff)
  const suppressNextActor = viewerHasPrimaryAction || showEstimateForm || showCompletionForm

  // Secondary controls card holds only post-work staff controls (pickup
  // toggle, billed reference) and now lives down with the billing context.
  // The primary stage action lives in the Next Step bar; manager destructive
  // actions live in their own footer at the very bottom of the page. Render
  // the secondary card only when it has content so we don't ship an empty one.
  const showPickupToggle =
    ticket.ticket_type === 'inside' &&
    (ticket.status === SERVICE_STATUS.COMPLETED || ticket.status === SERVICE_STATUS.BILLED) &&
    isStaff
  const showBilledRef =
    ticket.status === SERVICE_STATUS.BILLED && isStaff && synergyInvoiceNumber.trim().length > 0
  const showSecondaryControls = showPickupToggle || showBilledRef

  // Mobile sticky bottom action bar: keeps the single-tap primary action
  // reachable on a phone (the top Next Step bar scrolls away). Covers the
  // common tech stages only — manager input stages (estimated decision,
  // completed billing) keep using the top bar, which has room for their
  // sub-inputs. When it shows, the top bar is hidden for that stage so the
  // action isn't duplicated.
  const showMobileActionBar =
    isMobile && !showEstimateForm && !showCompletionForm && !quickCompleteOpen && (
      isWarrantyOpen ||
      (ticket.status === SERVICE_STATUS.OPEN && !isWarrantyOpen) ||
      (ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking) ||
      ticket.status === SERVICE_STATUS.IN_PROGRESS
    )

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div className={`space-y-6 ${showMobileActionBar ? 'pb-24' : ''}`}>
      {/* Workflow state card — top of detail page, always visible. */}
      <WorkflowStatusCard
        state={workflowProps.state}
        nextActor={suppressNextActor ? undefined : workflowProps.nextActor}
        blocker={workflowProps.blocker}
        enteredAt={ticket.updated_at}
      />

      {/* Ticket attributes — priority / type / billing / assignment.
          Sits directly under the status card so the viewer knows what kind of
          ticket this is before the alerts and the Next Step action. Status
          itself is owned by the WorkflowStatusCard above (not repeated here). */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Created {new Date(ticket.created_at).toLocaleDateString()}
              {ticket.assigned_technician && (
                <> | Assigned to <span className="font-medium text-gray-700 dark:text-gray-300">{ticket.assigned_technician.name}</span></>
              )}
            </span>
            {/* Reopen — undo completed work, kept accessible at the top. Shown
                only for worked states where handleReopen's target is valid;
                estimate-phase reopen (estimated/approved/declined) is handled by
                the "Reopen Estimate" button in the Diagnosis & Estimate card.
                Cancel/Delete remain in the bottom Manager Controls footer. */}
            {isManager && (ticket.status === SERVICE_STATUS.IN_PROGRESS ||
              ticket.status === SERVICE_STATUS.COMPLETED ||
              ticket.status === SERVICE_STATUS.BILLED) && (
              <button
                onClick={handleReopen}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Assign / reassign technician — staff only (managers + office staff).
          Backend already allows assigned_technician_id in STAFF_ALLOWED_FIELDS;
          this is the UI for assigning after creation or reassigning later. */}
      {isStaff && (
        <Card title="Assignment">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                Assigned Technician
              </label>
              <select
                value={assignedTechId}
                onChange={(e) => setAssignedTechId(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0 disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() =>
                apiAction(async () => {
                  await patchTicket({ assigned_technician_id: assignedTechId || null })
                  setSuccessMsg('Technician updated')
                })
              }
              disabled={loading || assignedTechId === (ticket.assigned_technician_id ?? '')}
              className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>

          {/* Billing type — correct a mis-keyed warranty/non-warranty ticket.
              Warranty bills the customer $0 and routes the ticket through the
              vendor-credit worklist before it can be billed. */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex-1">
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                Billing Type
              </label>
              <select
                value={billingType}
                onChange={(e) => setBillingType(e.target.value as ServiceBillingType)}
                disabled={loading}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0 disabled:opacity-50"
              >
                <option value="non_warranty">Non-Warranty</option>
                <option value="warranty">Warranty</option>
                <option value="partial_warranty">Partial Warranty</option>
              </select>
            </div>
            <button
              onClick={() =>
                apiAction(async () => {
                  await patchTicket({ billing_type: billingType })
                  setSuccessMsg('Billing type updated')
                })
              }
              disabled={loading || billingType === ticket.billing_type}
              className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Card>
      )}

      {/* Request More Info note — surfaced prominently when the manager has
          sent the estimate back. Visible to anyone viewing the ticket so
          everyone sees why it's back at "open". */}
      {ticket.status === SERVICE_STATUS.OPEN && ticket.request_info_note && (
        <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            Manager requested more info
          </p>
          <p className="text-sm text-amber-900 dark:text-amber-100 whitespace-pre-wrap">
            {ticket.request_info_note}
          </p>
        </div>
      )}

      {/* Pre-authorized work marker — surfaced for the life of the ticket once
          a non-warranty repair was started without an estimate. The authorizer
          is the manual_decision_note captured at bypass time. */}
      {ticket.estimate_bypassed && (
        <div className="rounded-lg border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-orange-800 dark:text-orange-300 uppercase tracking-wide">
            Started without estimate — pre-authorized
          </p>
          {ticket.manual_decision_note && (
            <p className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap">
              {ticket.manual_decision_note}
            </p>
          )}
        </div>
      )}

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

      {/* Credit review state (per-order AR decision). This is the single source
          of truth for "can this be worked?" — the customer-level credit_hold
          flag is only the trigger that created this review. */}
      {(() => {
        const reviews = ticket.credit_reviews ?? []
        const cr =
          reviews.find((r) => r.status === 'pending' || r.status === 'blocked') ??
          reviews.find((r) => r.status === 'released') ??
          null
        if (!cr) return null
        if (cr.status === 'released') {
          return (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border-2 border-green-300 dark:border-green-800 px-4 py-3">
              <p className="text-sm text-green-800 dark:text-green-300 font-semibold">
                Credit released — cleared by AR.
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                AR reviewed this order and cleared it for work and billing.
              </p>
            </div>
          )
        }
        if (cr.status === 'pending') {
          return (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-800 px-4 py-3">
              <p className="text-sm text-amber-800 dark:text-amber-300 font-semibold">
                Awaiting credit review by AR.
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This order was sent to AR for credit approval. Work is gated until AR releases it.
              </p>
            </div>
          )
        }
        return isStaff ? (
          <UnblockCreditPanel
            reviewId={cr.id}
            blockReason={cr.block_reason}
            decidedByName={cr.decided_by_name}
          />
        ) : (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-800 px-4 py-3">
            <p className="text-sm text-red-800 dark:text-red-300 font-semibold">
              Blocked by AR — manager release required.
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
              AR blocked this order. A manager must enter the release passcode before work can proceed.
            </p>
          </div>
        )
      })()}

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

      {/* Ready-to-bill nudge: completed without a Synergy invoice # */}
      {isStaff && ticket.status === SERVICE_STATUS.COMPLETED && !ticket.synergy_invoice_number && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-4 py-3 flex items-center gap-2">
          <svg className="h-5 w-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Add a Synergy invoice # below before this ticket can be marked billed.
          </p>
        </div>
      )}

      {/* ── Next Step: one contextual primary action per stage ──
          The same `viewerHasPrimaryAction` gate suppresses the redundant
          "Next:" line on the status card above. The estimate builder and
          completion form still live in their own cards below; the buttons
          here open them. On mobile, simple stages are handled by the sticky
          bottom bar, so the top bar yields to it (no duplicate button). */}
      {viewerHasPrimaryAction && !showMobileActionBar && !quickCompleteOpen && (
        <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-800 shadow-sm p-4 sm:p-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Next Step
          </p>

          {/* Open + warranty/partial → skip the estimate, start work */}
          {isWarrantyOpen && (
            <button
              onClick={handleStartWork}
              disabled={loading}
              className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Starting...' : 'Start Work'}
            </button>
          )}

          {/* Open + non-warranty → build / revise the estimate (opens builder below),
              or skip the estimate entirely when the work is already authorized. */}
          {ticket.status === SERVICE_STATUS.OPEN && !isWarrantyOpen && !showEstimateForm && (
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
              <button
                onClick={() => setShowEstimateForm(true)}
                className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-yellow-600 rounded-md hover:bg-yellow-700 transition-colors min-h-[44px]"
              >
                {ticket.estimate_amount != null ? 'Revise Estimate' : 'Build Estimate'}
              </button>
              <button
                onClick={() => setBypassOpen(true)}
                disabled={loading}
                className="w-full sm:w-auto px-5 py-3 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Start work — no estimate
              </button>
            </div>
          )}

          {/* Estimated → approve / decline / request more info. Staff get all
              three; technicians get Approve only (decline stays staff-only,
              request-more-info is manager-only below). Both commit paths require
              a note (who told us / why), shown via an inline-expand textarea
              before committing. */}
          {ticket.status === SERVICE_STATUS.ESTIMATED && (isStaff || isTech) && (
            manualDecisionMode === null ? (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setManualDecisionMode('approve')
                    setManualDecisionNote('')
                  }}
                  disabled={loading}
                  className="px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  Approve Estimate
                </button>
                {isStaff && (
                  <button
                    onClick={() => {
                      setManualDecisionMode('decline')
                      setManualDecisionNote('')
                    }}
                    disabled={loading}
                    className="px-5 py-3 text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Decline
                  </button>
                )}
                {isManager && (
                  <button
                    onClick={() => setRequestInfoOpen(true)}
                    disabled={loading}
                    className="px-5 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-white dark:bg-gray-700 border border-amber-300 dark:border-amber-600 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Request More Info
                  </button>
                )}
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
                    className={`px-5 py-3 text-sm font-semibold text-white rounded-md disabled:opacity-50 transition-colors min-h-[44px] ${
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
                    className="px-5 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          )}

          {/* Approved → start work (the parts-blocked case shows on the status card) */}
          {ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking && (
            <button
              onClick={handleStartWork}
              disabled={loading}
              className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Starting...' : 'Start Work'}
            </button>
          )}

          {/* In progress → complete the job (opens completion form below) */}
          {ticket.status === SERVICE_STATUS.IN_PROGRESS && !showCompletionForm && (
            <button
              onClick={() => setShowCompletionForm(true)}
              className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[44px]"
            >
              Complete Job
            </button>
          )}

          {/* Completed + staff → record Synergy invoice #, then bill */}
          {ticket.status === SERVICE_STATUS.COMPLETED && isStaff && (
            <div className="space-y-2">
              <SynergyNumberField
                initialValue={synergyInvoiceNumber}
                onSave={handleSaveSynergyInvoiceNumber}
                loading={loading}
                heading="Synergy Billing"
                fieldLabel="Invoice #"
              />
              {!synergyInvoiceNumber.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Enter and save the Synergy Invoice # above before billing.
                </p>
              )}
              <button
                onClick={handleMarkBilled}
                disabled={loading || !synergyInvoiceNumber.trim()}
                className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {loading ? 'Saving...' : 'Mark Billed'}
              </button>
            </div>
          )}
        </div>
      )}

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
            {/* Tech/staff equipment relocation — parity with PM ticket detail.
                Only for linked equipment (inline-only equipment has no row to
                move) and while the ticket is still active. */}
            {ticket.equipment_id &&
              !['completed', 'billed', 'declined', 'canceled'].includes(ticket.status) && (
                <div className="mt-2">
                  <ChangeLocationSection
                    ticketId={ticket.id}
                    customerId={ticket.customer_id}
                    equipmentId={ticket.equipment_id}
                    currentShipToId={ticket.ship_to_location_id ?? null}
                    relocateUrl={`/api/service-tickets/${ticket.id}/relocate`}
                    requestTicketField="service_ticket_id"
                  />
                </div>
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
          {/* Customer PO # — editable by techs and staff. The PO often arrives
              while the tech is on-site mid-repair (feedback #38), so it can be
              recorded here at any point. Emphasized when the customer requires a
              PO; still available (optional) when they don't. */}
          <div className="md:col-span-2">
            <span className="text-gray-500 dark:text-gray-400 text-sm">
              Customer PO #
              {ticket.customers?.po_required && (
                <span className="ml-2 font-bold text-red-700 dark:text-red-400">— PO REQUIRED</span>
              )}
            </span>
            <div className="mt-1 flex flex-col sm:flex-row gap-2 sm:max-w-md">
              <input
                type="text"
                value={poNumber}
                onChange={(e) => { setPoNumber(e.target.value); setPoSaved(false) }}
                placeholder="Enter customer PO if known"
                className="flex-1 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0"
              />
              <button
                type="button"
                onClick={handleSavePoNumber}
                disabled={poSaving || poSaved}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0 shrink-0"
              >
                {poSaving ? 'Saving…' : poSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Section 3: Problem Description ── */}
      <Card title="Problem Description">
        <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
          {ticket.problem_description}
        </p>
      </Card>

      {/* ── Section 4: Diagnosis & Estimate ──
          Renders once an estimate exists, the ticket is past the estimate
          stage, or the builder is open (triggered from the Next Step bar).
          A fresh `open` ticket shows no empty estimate card. */}
      {(ticket.status === SERVICE_STATUS.ESTIMATED || ticket.status === SERVICE_STATUS.APPROVED ||
        ticket.status === SERVICE_STATUS.DECLINED || ticket.estimate_amount != null || showEstimateForm) && (
        <div ref={estimateCardRef}>
        <CardSection
          title="Diagnosis & Estimate"
          open={estimateOpen}
          summarySuffix={ticket.estimate_amount != null ? (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              ${ticket.estimate_amount.toFixed(2)}
            </span>
          ) : undefined}
        >
          {/* Show existing estimate breakdown */}
          {ticket.estimate_amount != null && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <InfoField label="Approval Status">
                  {ticket.estimate_approved ? (
                    <span className="text-green-600 dark:text-green-400">
                      Approved
                      {ticket.auto_approved && (
                        <span className="ml-1 text-xs">(auto &lt; $100)</span>
                      )}
                    </span>
                  ) : ticket.status === SERVICE_STATUS.DECLINED ? (
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
                            {partLabel(part)} x{part.quantity}
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
              {ticket.manual_decision_note && (ticket.status === SERVICE_STATUS.APPROVED || ticket.status === SERVICE_STATUS.DECLINED) && (
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
                {/* Reopen Estimate — managers/super admins only. Pulls the
                    estimate back to an editable draft (numbers preserved) from
                    awaiting-approval, approved, or declined so it can be revised
                    and re-sent. */}
                {isManager &&
                  (ticket.status === SERVICE_STATUS.ESTIMATED ||
                    ticket.status === SERVICE_STATUS.APPROVED ||
                    ticket.status === SERVICE_STATUS.DECLINED) && (
                  <button
                    onClick={handleReopenEstimate}
                    disabled={loading}
                    className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
                  >
                    Reopen Estimate
                  </button>
                )}
              </div>

              {/* Approval link display */}
              {ticket.status === SERVICE_STATUS.ESTIMATED && ticket.approval_token && (
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

              {/* Customer follow-up status + log-call (estimated state, staff).
                  Mirrors the estimate follow-up queue so the office can record a
                  call without leaving the ticket. First contact = emailed OR
                  called; an estimate with neither is flagged. */}
              {ticket.status === SERVICE_STATUS.ESTIMATED && isStaff && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Customer Follow-Up</label>
                  {ticket.estimate_emailed_at ? (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Emailed {new Date(ticket.estimate_last_emailed_at ?? ticket.estimate_emailed_at).toLocaleDateString()}
                      {ticket.estimate_notify_count > 1 ? ` (${ticket.estimate_notify_count}×)` : ''}
                      {ticket.estimate_called_at ? ` · Called ${new Date(ticket.estimate_called_at).toLocaleDateString()}` : ''}
                    </p>
                  ) : ticket.estimate_called_at ? (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Called {new Date(ticket.estimate_called_at).toLocaleDateString()}
                      {ticket.estimate_contact_notes ? ` — ${ticket.estimate_contact_notes}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      No first contact yet — email the estimate above or log a call.
                    </p>
                  )}
                  {estimateCallOpen ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <input
                        autoFocus
                        value={estimateCallNotes}
                        onChange={(e) => setEstimateCallNotes(e.target.value)}
                        placeholder="Call notes (optional)"
                        className="w-full sm:w-64 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleLogEstimateCall}
                          disabled={loading}
                          className="px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {loading ? 'Saving…' : 'Log call'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEstimateCallOpen(false); setEstimateCallNotes('') }}
                          disabled={loading}
                          className="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEstimateCallOpen(true)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {ticket.estimate_called_at ? 'Log follow-up call' : 'Log call'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Declined: reason + reopen, grouped */}
          {ticket.status === SERVICE_STATUS.DECLINED && (
            <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700 space-y-3">
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Estimate Declined
              </p>
              {ticket.decline_reason && (
                <InfoField label="Decline Reason">
                  <span className="font-normal text-red-600 dark:text-red-400">{ticket.decline_reason}</span>
                </InfoField>
              )}
              {/* Reopen is offered by the unified "Reopen Estimate" button in the
                  Diagnosis & Estimate card above (preserves the numbers). */}
            </div>
          )}

          {/* Estimate builder — opened from the Next Step bar above */}
          {ticket.status === SERVICE_STATUS.OPEN && showEstimateForm && (
            <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                {ticket.estimate_amount != null ? 'Revise Estimate' : 'Build Estimate'}
              </p>
              {/* Verify-first: identify the machine before the estimate so the
                  tech can order parts (the part-request gate needs make/model/
                  serial on a verified unit). Same panel the completion form
                  uses; verifying refreshes the ticket and reveals the form. */}
              {equipmentToVerify ? (
                <VerifyEquipmentPanel
                  equipmentId={equipmentToVerify.id}
                  make={equipmentToVerify.make}
                  model={equipmentToVerify.model}
                  serial={equipmentToVerify.serial_number}
                  onVerified={handleEquipmentVerified}
                  relinkTicketId={ticket.id}
                  relinkTicketKind="service"
                />
              ) : (
              <form onSubmit={handleSubmitEstimate} className="space-y-4">
                  {/* Labor Rate Type — staff can correct the rate the office picked at intake */}
                  {isStaff && (
                    <div className="max-w-lg">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Labor Rate Type
                      </label>
                      <select
                        value={estimateRateType}
                        onChange={(e) => setEstimateRateType(e.target.value)}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                      >
                        <option value="standard">Standard — ${laborRates.standard.toFixed(2)}/hr</option>
                        <option value="industrial">Industrial — ${laborRates.industrial.toFixed(2)}/hr</option>
                        <option value="vacuum">Vacuum — ${laborRates.vacuum.toFixed(2)}/hr</option>
                      </select>
                    </div>
                  )}

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
                        @ ${effectiveEstRate.toFixed(2)}/hr
                      </span>
                    </div>
                  </div>

                  {/* Trip Charge — flat fee for the trip out, billed alongside labor.
                      Visible to techs too: they set the trip count on their own
                      ticket; the per-trip rate stays office-controlled in Settings. */}
                  <div className="max-w-lg">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Trip Charge
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={tripChargeQty}
                        onChange={(e) => setTripChargeQty(e.target.value)}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="0"
                      />
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {tripChargeRate > 0
                          ? `× $${tripChargeRate.toFixed(2)}/trip = $${tripChargeNum.toFixed(2)}`
                          : 'trips — set the rate in Settings'}
                      </span>
                    </div>
                  </div>

                  {/* Estimated Parts */}
                  <PartsEntryList
                    parts={estimateParts}
                    setParts={setEstimateParts}
                    showPricing={true}
                    showWarranty={ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty'}
                    showVendor={true}
                    showVendorItemCode={true}
                    label="Estimated Parts"
                    allowPriceOverride={isStaff}
                    allowPriceEdit={isTech}
                    onRequestPart={machineComplete ? handleRequestEstimatePart : undefined}
                  />
                  {!machineComplete && estimateParts.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Add the machine make, model, and serial number above before requesting parts to be ordered.
                    </p>
                  )}

                  {/* Estimate summary */}
                  <div className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3 max-w-lg">
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Labor: {estimateLaborHours || '0'} hrs x ${effectiveEstRate.toFixed(2)}</span>
                        <span>${estLaborTotal.toFixed(2)}</span>
                      </div>
                      {estimateParts.length > 0 && (
                        <div className="flex justify-between">
                          <span>Parts {ticket.billing_type === 'warranty' ? '(warranty — $0)' : ''}</span>
                          <span>${estPartsTotal.toFixed(2)}</span>
                        </div>
                      )}
                      {tripChargeNum > 0 && (
                        <div className="flex justify-between">
                          <span>Trip: {tripChargeQtyNum} × ${tripChargeRate.toFixed(2)}</span>
                          <span>${tripChargeNum.toFixed(2)}</span>
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
        </CardSection>
        </div>
      )}

      {/* ── Diagnostic Fee (staff, any active stage) ── */}
      {isStaff && ticket.status !== 'billed' && ticket.status !== 'canceled' && (
        <DiagnosticFeeCard
          invoiceNumber={diagnosticInvoiceNumber}
          setInvoiceNumber={setDiagnosticInvoiceNumber}
          amount={diagnosticCharge}
          setAmount={setDiagnosticCharge}
          onSave={handleSubmitDiagnosticCharge}
          loading={loading}
          currentCharge={ticket.diagnostic_charge}
          currentInvoiceNumber={ticket.diagnostic_invoice_number}
        />
      )}

      {/* ── Section 5: Parts Requested ──
          Collapsible. Stays open whenever something needs attention
          (status is pre-completion AND not all parts received). Auto-closes
          once everything is received so the tech doesn't scroll past it. */}
      {(partsRequested.length > 0 || (ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled')) && (
        <CardSection
          title={`Parts Requested${livePartsRequested.length > 0 ? ` (${partsReceivedCount}/${livePartsRequested.length} received)` : ''}`}
          open={
            // Pre-completion AND something pending → open by default
            ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled' &&
            (livePartsRequested.length === 0 || !allPartsReceived)
          }
          summarySuffix={allPartsReceived ? (
            <Badge label="All Received" classes="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" />
          ) : undefined}
        >
          {/* "View in Parts Queue" — consumes the Round A query-param contract.
              The link works regardless of Round A's filter shipping; if that
              round hasn't merged yet, parts-queue just shows its default view. */}
          {isStaff && partsRequested.length > 0 && (
            <div className="mb-3">
              <Link
                href={`/parts-queue?source=service&ticket=${ticket.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                View in Parts Queue
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
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
                    pending_review: 'text-slate-600 dark:text-slate-400',
                    requested: 'text-yellow-600 dark:text-yellow-400',
                    ordered: 'text-blue-600 dark:text-blue-400',
                    received: 'text-green-600 dark:text-green-400',
                    from_stock: 'text-teal-600 dark:text-teal-400',
                  }
                  const statusLabels: Record<string, string> = {
                    pending_review: 'In Review',
                    requested: 'Requested',
                    ordered: 'Ordered',
                    received: 'Received',
                    from_stock: 'From Stock',
                  }
                  return (
                    <div key={i} className="flex flex-col gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${part.cancelled ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{partLabel(part)}</span>
                          {part.product_number && isTech && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">#{part.product_number}</span>
                          )}
                          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">x{part.quantity}</span>
                          {part.po_number && isTech && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">PO: {part.po_number}</span>
                          )}
                          {!part.cancelled && poDueDates[`${part.po_number ?? ''}|${part.product_number ?? ''}`] && (
                            <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                              Est. arrival {formatDate(poDueDates[`${part.po_number ?? ''}|${part.product_number ?? ''}`])}
                            </div>
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
                              {statusLabels[part.status] ?? part.status}
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

          {/* Add part request — tech or staff. Blocked until the machine is
              identified (verified make/model on a linked unit, or make/model/
              serial on an inline ticket) so the office knows what it's for. The
              verify panel lives in the Diagnosis & Estimate step above. */}
          {ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled' && (
            !machineComplete ? (
              ticket.equipment ? (
                // Linked equipment row — the tech verifies it via the
                // VerifyEquipmentPanel that lives in the estimate/completion form.
                <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                  Verify the machine make, model, and serial number before requesting parts. Use the verify step in Diagnosis &amp; Estimate above.
                </div>
              ) : (
                // Inline-only ticket (no equipment row) — there's no verify panel,
                // so let the on-site tech fill the details right here (feedback #41).
                <div className="mt-2">
                  <TechEquipmentDetailsPanel
                    ticketId={ticket.id}
                    make={ticket.equipment_make}
                    model={ticket.equipment_model}
                    serial={ticket.equipment_serial_number}
                    onSaved={handleEquipmentVerified}
                  />
                </div>
              )
            ) : (
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
                  {/* Part description — searches the Synergy product catalog.
                      Picking a stock item locks the description to a chip and
                      prefills item #, price, vendor, and vendor part #. */}
                  {newPartIsCatalog ? (
                    <div className="flex items-center gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 py-3 sm:py-2 text-sm text-gray-900 dark:text-white">
                      <span className="flex-1 truncate">
                        {newPartNumber ? <span className="font-mono">{newPartNumber}</span> : null}
                        {newPartNumber ? ' — ' : ''}{newPartDesc}
                      </span>
                      <button
                        type="button"
                        onClick={clearCatalogPart}
                        title="Clear and enter manually"
                        className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0 p-1"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <div className="relative" ref={partComboRef}>
                      <input
                        type="text"
                        value={newPartDesc}
                        onChange={(e) => { setNewPartDesc(e.target.value); partSearch.setQuery(e.target.value) }}
                        onFocus={() => { if (partSearch.results.length > 0) setPartComboOpen(true) }}
                        placeholder="Search parts or type a description"
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                      {partSearch.comboOpen && partSearch.results.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {partSearch.results.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => selectCatalogPart(p)}
                              className="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                            >
                              <span className="font-mono text-gray-900 dark:text-white">{p.number}</span>
                              {p.description && <span className="text-gray-500 dark:text-gray-400"> — {p.description}</span>}
                              {p.unit_price != null && (
                                <span className="text-green-700 dark:text-green-400 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">${p.unit_price.toFixed(2)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {partSearch.comboOpen && !partSearch.loading && partSearch.results.length === 0 && newPartDesc.trim() && (
                        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                          No catalog match — enter the part details manually below.
                        </div>
                      )}
                    </div>
                  )}
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
                  {/* Vendor — Synergy-only picker. Prefilled (with a "synergy"
                      badge) when a catalog item is chosen; key remounts it so the
                      collapsed badge reflects the prefilled vendor / a cleared field. */}
                  <VendorPicker
                    key={`add-part-vendor-${newPartSynergyProductId ?? 'manual'}`}
                    vendor={newPartVendor}
                    vendorCode={newPartVendorCode}
                    onChange={({ vendor, vendor_code }) => { setNewPartVendor(vendor); setNewPartVendorCode(vendor_code) }}
                  />
                  <input
                    type="text"
                    value={newPartVendorItemCode}
                    onChange={(e) => setNewPartVendorItemCode(e.target.value)}
                    placeholder={newPartIsCatalog ? 'Vendor part # (optional)' : 'Vendor part # (required)'}
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPartPrice}
                    onChange={(e) => setNewPartPrice(e.target.value)}
                    placeholder={newPartIsCatalog ? 'Price to charge customer (optional; enter 0 if warranty)' : 'Price to charge customer (required; enter 0 if warranty)'}
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddPartRequest}
                      disabled={loading || !addPartReady}
                      title={addPartReady ? 'Request this part to be ordered' : 'Enter vendor name, vendor part #, description, and price first'}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
                    >
                      {loading ? 'Adding...' : 'Add Part'}
                    </button>
                    <button
                      onClick={resetAddPartForm}
                      className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
            )
          )}

          {/* Synergy order # — staff only, for the parts-ordering flow (pre-completion).
              On completed/billed tickets the field lives in the Actions card instead. */}
          {isStaff && !['open', 'canceled', 'declined', 'completed', 'billed'].includes(ticket.status) && (
            <SynergyNumberField
              initialValue={ticket.synergy_order_number ?? ''}
              onSave={handleSaveSynergyOrderNumber}
              loading={loading}
            />
          )}
        </CardSection>
      )}

      {/* ── Section 7: Completion Form ──
          Collapsible — opens by default in_progress; on mobile it's also the
          only open section. */}
      {ticket.status === SERVICE_STATUS.IN_PROGRESS && showCompletionForm && (
        <div ref={completionCardRef}>
        <CardSection title="Complete Job" open={completionOpen}>
          {equipmentToVerify ? (
            <VerifyEquipmentPanel
              equipmentId={equipmentToVerify.id}
              make={equipmentToVerify.make}
              model={equipmentToVerify.model}
              serial={equipmentToVerify.serial_number}
              onVerified={handleEquipmentVerified}
              relinkTicketId={ticket.id}
              relinkTicketKind="service"
            />
          ) : (
          <form onSubmit={handleComplete} className="space-y-5 max-w-xl">
            {/* Prefilled-from-estimate reminder. Only shown when an estimate was
                approved — the work order was seeded from it on Start Work. Calls
                out the diagnosis-vs-completion distinction explicitly so the tech
                rewrites the notes to what was actually done. */}
            {ticket.estimate_approved && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                These values were copied from the approved estimate. Update the
                hours, parts, and completion notes to reflect the actual work
                done before marking complete.
              </div>
            )}

            {/* Warranty confirmation — a repair often turns out to be a warranty
                claim once the tech is on the machine, but the ticket was keyed
                non-warranty. Confirm/correct it here at completion. Warranty
                bills the customer $0 and routes the ticket to the vendor-credit
                worklist. Saved just before the job is marked complete. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Billing Type
              </label>
              <select
                value={billingType}
                onChange={(e) => setBillingType(e.target.value as ServiceBillingType)}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="non_warranty">Non-Warranty</option>
                <option value="warranty">Warranty (no charge to customer)</option>
                <option value="partial_warranty">Partial Warranty</option>
              </select>
              {billingType !== ticket.billing_type && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Changed to {billingTypeLabels[billingType] ?? billingType} — saved when you complete the job.
                </p>
              )}
            </div>

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

            {/* Trip Charge — flat fee for the trip out, billed alongside labor.
                Visible to techs too: they set the trip count on their own ticket;
                the per-trip rate stays office-controlled in Settings. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Trip Charge
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={tripChargeQty}
                  onChange={(e) => setTripChargeQty(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="0"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {tripChargeRate > 0
                    ? `× $${tripChargeRate.toFixed(2)}/trip = $${tripChargeNum.toFixed(2)}`
                    : 'trips — set the rate in Settings'}
                </span>
              </div>
            </div>

            {/* Machine Hours + Date Code — optional equipment service-life data
                (parity with PM completion; optional since not every service unit
                has an hour meter). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="svc-machine-hours" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Machine Hours <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="svc-machine-hours"
                  type="number"
                  step="0.1"
                  min="0"
                  value={machineHours}
                  onChange={(e) => setMachineHours(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="e.g. 1247.5"
                />
              </div>
              <div>
                <label htmlFor="svc-date-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date Code <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="svc-date-code"
                  type="text"
                  value={dateCode}
                  onChange={(e) => setDateCode(e.target.value)}
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="e.g. 26W15"
                />
              </div>
            </div>

            {/* Parts Used — collapsible sub-section so the tech can skip
                past it on mobile when nothing's been added. */}
            <details open={completionParts.length > 0} className="rounded-md border border-gray-200 dark:border-gray-700">
              <summary className="px-3 py-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 marker:content-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
                <span>Parts Used{completionParts.length > 0 ? ` (${completionParts.length})` : ''}</span>
                <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </summary>
              <div className="p-3 pt-0">
                <PartsEntryList
                  parts={completionParts}
                  setParts={setCompletionParts}
                  showPricing={true}
                  showWarranty={billingType === 'warranty' || billingType === 'partial_warranty'}
                  label=""
                  allowPriceOverride={isStaff}
                  allowPriceEdit={isTech}
                />
              </div>
            </details>

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
                {tripChargeNum > 0 && (
                  <div className="flex justify-between">
                    <span>Trip: {tripChargeQtyNum} × ${tripChargeRate.toFixed(2)}</span>
                    <span>${tripChargeNum.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-300 dark:border-gray-700">
                <span className="text-base font-bold text-gray-900 dark:text-white">Billing Total</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">${billingTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Photos — collapsible sub-section. Default-open whenever
                photos exist so the tech can review what they've captured
                without an extra tap. */}
            <details open={photos.length > 0} className="rounded-md border border-gray-200 dark:border-gray-700">
              <summary className="px-3 py-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 marker:content-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
                <span>Service Photos{photos.length > 0 ? ` (${photos.length})` : ''}</span>
                <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </summary>
              <div className="p-3 pt-0">
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
              {/* `capture="environment"` opens the rear camera by default on
                  mobile while still allowing library picks; desktop browsers
                  ignore the attribute. `multiple` keeps batch upload working
                  on both. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
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
            </details>

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
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        ACE Hours
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={aceHours}
                        onChange={(e) => setAceHours(e.target.value)}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reason
                      </label>
                      <textarea
                        value={aceReason}
                        onChange={(e) => setAceReason(e.target.value)}
                        rows={2}
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="Why this is ACE-eligible (visible to your manager)..."
                      />
                    </div>
                  </div>
                </>
              )}
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
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading || uploading || saving}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {loading ? 'Completing...' : 'Mark Complete'}
              </button>
              {saving && (
                <span className="text-sm text-gray-500 dark:text-gray-400">Saving...</span>
              )}
              {saveSuccess && !saving && (
                <span className="text-sm text-green-600">Saved</span>
              )}
            </div>
          </form>
          )}
        </CardSection>
        </div>
      )}

      {/* ── Section 8: Billing Summary (read-only, completed/billed) ── */}
      {(ticket.status === SERVICE_STATUS.COMPLETED || ticket.status === SERVICE_STATUS.BILLED) && (
        <Card title="Billing Summary">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoField label="Billing Amount">
              {ticket.billing_amount != null ? `$${ticket.billing_amount.toFixed(2)}` : '—'}
            </InfoField>
            <InfoField label="Hours Worked">
              {ticket.hours_worked ?? '—'}
            </InfoField>
            {ticket.machine_hours != null && (
              <InfoField label="Machine Hours">
                {ticket.machine_hours}
              </InfoField>
            )}
            {ticket.date_code && (
              <InfoField label="Date Code">
                {ticket.date_code}
              </InfoField>
            )}
            <InfoField label="Labor Total">
              ${((ticket.hours_worked ?? 0) * laborRate).toFixed(2)}
            </InfoField>
            <InfoField label="Parts Total">
              ${(ticket.parts_used ?? []).reduce((sum, p) => sum + (p.warranty_covered ? 0 : p.quantity * p.unit_price), 0).toFixed(2)}
            </InfoField>
            <InfoField label="Synergy Order #">
              {ticket.synergy_order_number ?? '—'}
            </InfoField>
            {ticket.synergy_invoice_number && (
              <InfoField label="Synergy Invoice #">
                {ticket.synergy_invoice_number}
              </InfoField>
            )}
            {(() => {
              const qty = ticket.trip_charge_qty != null ? ticket.trip_charge_qty : 0
              return qty > 0 && tripChargeRate > 0 ? (
                <InfoField label="Trip Charge">
                  {qty} × ${tripChargeRate.toFixed(2)} = ${(qty * tripChargeRate).toFixed(2)}
                </InfoField>
              ) : null
            })()}
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
                      {partLabel(part)} x{part.quantity}
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

          {/* Customer-facing completion document (parity with the PM work order). */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleDownloadWorkOrder}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              Download Work Order PDF
            </button>
          </div>
        </Card>
      )}

      {/* ── Secondary controls (pickup toggle / billed reference) ──
          Post-work staff controls; live with the billing context rather than
          mid-workflow. Render only when non-empty. */}
      {showSecondaryControls && (
        <Card title="Actions">
          <div className="space-y-3">
            {/* Billed: show the recorded Synergy invoice # for reference (staff) */}
            {showBilledRef && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Billed under Synergy Invoice # <span className="font-medium text-gray-900 dark:text-white">{synergyInvoiceNumber}</span>
              </p>
            )}

            {/* Inside ticket pickup toggle */}
            {showPickupToggle && (
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
                {ticket.picked_up_at ? 'Customer Picked Up' : ticket.awaiting_pickup ? 'Awaiting Customer Pickup' : 'Mark Awaiting Customer Pickup'}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Completion details for techs (no billing) */}
      {(ticket.status === SERVICE_STATUS.COMPLETED || ticket.status === SERVICE_STATUS.BILLED) && isTech && (
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
                    {partLabel(part)} x{part.quantity}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Manager controls ──
          Destructive, low-frequency actions (cancel / delete) live at the very
          bottom of the page so they can't be hit by accident mid-task. Reopen
          is routine, so it lives up top in the attributes strip instead. */}
      {isManager && (
        <Card title="Manager Controls">
          <div className="flex flex-wrap gap-2">
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
        </Card>
      )}

      {/* Request More Info modal — manager only, on Awaiting Approval.
          `key` toggles a remount so opening twice always starts fresh. */}
      <RequestInfoModal
        key={`request-info-${requestInfoOpen}`}
        open={requestInfoOpen}
        initialDraft="Please add labor estimate for "
        busy={loading}
        onSubmit={handleRequestMoreInfo}
        onCancel={() => setRequestInfoOpen(false)}
      />

      <BypassEstimateModal
        key={`bypass-${bypassOpen}`}
        open={bypassOpen}
        busy={loading}
        onSubmit={handleBypassEstimate}
        onCancel={() => setBypassOpen(false)}
      />

      {/* Mobile sticky action bar — the primary action stays reachable at the
          bottom of the screen on phones (≤640px) per the mobile-first-for-techs
          rule. in_progress opens the QuickCompleteSheet for the assigned tech,
          else the inline completion form. */}
      {showMobileActionBar && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {isWarrantyOpen && (
            <button
              type="button"
              onClick={handleStartWork}
              disabled={loading}
              className="w-full px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[48px]"
            >
              {loading ? 'Starting...' : 'Start Work'}
            </button>
          )}
          {ticket.status === SERVICE_STATUS.OPEN && !isWarrantyOpen && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowEstimateForm(true)}
                className="w-full px-5 py-3 text-sm font-semibold text-white bg-yellow-600 rounded-md hover:bg-yellow-700 transition-colors min-h-[48px]"
              >
                {ticket.estimate_amount != null ? 'Revise Estimate' : 'Build Estimate'}
              </button>
              <button
                type="button"
                onClick={() => setBypassOpen(true)}
                disabled={loading}
                className="w-full px-5 py-3 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[48px]"
              >
                Start work — no estimate
              </button>
            </div>
          )}
          {ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking && (
            <button
              type="button"
              onClick={handleStartWork}
              disabled={loading}
              className="w-full px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[48px]"
            >
              {loading ? 'Starting...' : 'Start Work'}
            </button>
          )}
          {ticket.status === SERVICE_STATUS.IN_PROGRESS && (
            <button
              type="button"
              onClick={() => (quickCompleteEligible ? setQuickCompleteOpen(true) : setShowCompletionForm(true))}
              className="w-full px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[48px]"
            >
              Complete Job
            </button>
          )}
        </div>
      )}
      <QuickCompleteSheet
        key={`quick-complete-${quickCompleteOpen}`}
        open={quickCompleteOpen}
        busy={loading}
        signatureRequired={signatureRequired}
        onCancel={() => setQuickCompleteOpen(false)}
        onSubmit={handleQuickComplete}
      />
      <CompletionSuccessDialog
        open={completed}
        ticketsHref="/service"
        ticketsLabel="Back to Service Tickets"
        onViewWorkOrder={() => setCompleted(false)}
      />
    </div>
  )
}

// ── Sub-components ──

// Single Synergy number field with a Save button. Used in two contexts on a
// service ticket: the parts-ordering order # (default labels) and the billing
// invoice # (override the heading/fieldLabel). They write to different columns,
// so each instance gets its own initial value and onSave handler.
function SynergyNumberField({
  initialValue,
  onSave,
  loading,
  heading = 'Synergy Ordering',
  fieldLabel = 'Order #',
}: {
  initialValue: string
  onSave: (value: string) => Promise<void>
  loading: boolean
  heading?: string
  fieldLabel?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [dirty, setDirty] = useState(false)

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wide">{heading}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{fieldLabel}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setDirty(true) }}
            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        {dirty && (
          <button
            onClick={() => { onSave(value); setDirty(false) }}
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
