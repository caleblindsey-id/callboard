'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import UnblockCreditPanel from '@/components/UnblockCreditPanel'
import ReadOnlyPhotos from '@/components/ReadOnlyPhotos'
import { PartEntry, partsFromSaved, toServicePartUsed } from '@/components/service/PartsEntryList'
import { useFormDraft } from '@/lib/hooks/useFormDraft'
import { partLabel, partsOnOrder } from '@/lib/parts'
import { computePartsTax } from '@/lib/tax'
import { useProductSearch, type ProductSearchResult } from '@/lib/hooks/useProductSearch'
import WorkflowStatusCard from '@/components/WorkflowStatusCard'
import CompletionSuccessDialog from '@/components/CompletionSuccessDialog'
import ConfirmDialog from '@/components/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import InlineError from '@/components/ui/InlineError'
import { createClient } from '@/lib/supabase/client'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import { getStatusMeta } from '@/lib/status-meta'
import RegisterEquipmentPanel from './RegisterEquipmentPanel'
import { equipmentNeedsVerification, equipmentReadyForParts } from '@/lib/equipment'
import type { LineViolation } from '@/lib/margin'
import DiagnosticFeeCard from './DiagnosticFeeCard'
import EstimateSection from './EstimateSection'
import PartsSection from './PartsSection'
import CompletionSection from './CompletionSection'
import NextStepBar from './NextStepBar'
import { Badge, Card, InfoField, billingTypeLabels } from './detail-ui'
import ChangeLocationSection from '@/app/tickets/[id]/ChangeLocationSection'
import ChangeBillToSection from '@/app/tickets/[id]/ChangeBillToSection'
import type {
  ServiceTicketDetail as ServiceTicketDetailType,
  ServiceTicketStatus,
  ServiceBillingType,
  ServiceTicketType,
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
  // Customer sales-tax rate as a percent (e.g. 7.75); 0 when exempt or none on
  // file. Display-only — applied to the parts subtotal only (migration 133).
  taxRatePercent: number
  // Estimated arrival dates for ordered parts, keyed `${po_number}|${product_number}`.
  // Looked up server-side from Synergy's open PO lines (getPoDueDates). Absent
  // key = part isn't on an open PO, so nothing is shown.
  poDueDates?: Record<string, string>
  // True for managers/coordinators always, and for a technician only when the
  // per-tech create-service-tickets flag is on. Gates the Email Estimate button;
  // the server (send-estimate route) remains the source of truth.
  canEmailEstimate?: boolean
}

// Local (localStorage) safety net for the in-progress completion form — the
// 3s server autosave (saveProgress) is still authoritative; this is what
// survives an offline/airplane-mode session between saves. Deliberately
// excludes photos and the signature (large/binary, mirrors the "photos
// aren't saved in drafts" convention in SubmitLeadModal). Estimate-phase
// fields are out of scope (Round 9 targets the completion form only).
interface ServiceCompletionDraft {
  billingType: ServiceBillingType
  hoursWorked: string
  tripChargeQty: string
  machineHours: string
  dateCode: string
  completionNotes: string
  completionParts: PartEntry[]
  aceLaborOpen: boolean
  aceHours: string
  aceReason: string
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


// ── Component ──

// ── Render helpers (Badge, Card, InfoField, CardSection) live in ./detail-ui,
// outside this component so React never remounts them on a re-render; the
// extracted section components import them directly. ──

// ── Workflow card helpers ───────────────────────────────────────────────────

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
  const label = getStatusMeta('service', status).label
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

  return (
    <Modal open={open} onClose={onCancel} dismissible={!busy} size="lg" ariaLabelledBy="request-info-title">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 id="request-info-title" className="text-base font-semibold text-gray-900 dark:text-white">
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
    </Modal>
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

  return (
    <Modal open={open} onClose={onCancel} dismissible={!busy} size="lg" ariaLabelledBy="bypass-estimate-title">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 id="bypass-estimate-title" className="text-base font-semibold text-gray-900 dark:text-white">
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
    </Modal>
  )
}

interface MarginOverrideModalProps {
  // Non-null while the prompt is open; the violations come straight from the
  // server's 400 response (each line's price vs. its 15% floor).
  violations: LineViolation[] | null
  onSubmit: (note: string) => void
  onCancel: () => void
}

// Manager-only: approve a below-floor part price (down to loaded cost) with a
// required justification. Shown when a manager's save is rejected at the 15%
// margin floor; on confirm the parent re-sends the save with the override flag.
function MarginOverrideModal({ violations, onSubmit, onCancel }: MarginOverrideModalProps) {
  // Parent remounts via `key` so the field starts empty each time it opens.
  const [note, setNote] = useState('')

  return (
    <Modal open={violations !== null} onClose={onCancel} size="lg" ariaLabelledBy="margin-override-title">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 id="margin-override-title" className="text-base font-semibold text-gray-900 dark:text-white">
          Approve below-floor price
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          One or more parts are priced below the 15% margin floor. As a manager you can approve
          this down to loaded cost (never below cost). A reason is required for the record.
        </p>
      </div>
      <div className="p-5">
        <ul className="mb-4 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {(violations ?? []).map((v) => (
            <li key={v.index} className="flex justify-between gap-3">
              <span className="truncate">{v.description}</span>
              <span className="whitespace-nowrap">
                ${v.unitPrice.toFixed(2)}{' '}
                <span className="text-gray-400 dark:text-gray-500">(floor ${v.minPrice.toFixed(2)})</span>
              </span>
            </li>
          ))}
        </ul>
        <label htmlFor="margin-override-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Reason for the below-floor price <span className="text-red-600">*</span>
        </label>
        <textarea
          id="margin-override-note"
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Price-matched competitor quote for ABC Corp — approved by Caleb"
          className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{note.length} / 2000</p>
      </div>
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(note.trim())}
          disabled={note.trim().length < 2}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          Approve &amp; Save
        </button>
      </div>
    </Modal>
  )
}

// Requested parts eligible to copy onto the completed work order — fulfilled
// (received, or pulled from stock) and not cancelled. Mirrors the PM ticket
// completion-seed filter (TicketActions.tsx requestedReceived) so both ticket
// types treat "fulfilled" the same way; unlike PM, this is copied on demand
// via a button rather than auto-seeded (service tickets have no
// completion_seeded_at guard to stop a re-seed from resurrecting a part the
// tech deliberately removed).
function fulfilledRequestedParts(requested: PartRequest[]): PartRequest[] {
  return requested.filter(
    (r) => (r.status === 'received' || r.status === 'from_stock') && !r.cancelled
  )
}

// Dedupe key for a requested part vs an already-added completion part:
// Synergy item # when catalog-linked, else the normalized description.
function partDedupeKey(p: { synergyProductId?: number | null; synergy_product_id?: number | null; description: string }): string {
  const id = p.synergyProductId ?? p.synergy_product_id
  return id != null ? `id:${id}` : `desc:${p.description.trim().toLowerCase()}`
}

export function ServiceTicketDetail({ ticket, userRole, userId, laborRate, laborRates, tripChargeRate, taxRatePercent, poDueDates = {}, canEmailEstimate = false }: ServiceTicketDetailProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'
  const isManager = userRole === 'super_admin' || userRole === 'manager'
  const isStaff = !isTech && userRole !== null

  // --- State ---
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  // Destructive actions (reopen / cancel / delete / reopen-estimate) confirm
  // through the shared dialog instead of window.confirm(); the pending action
  // is held here.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    action: () => void
  } | null>(null)

  // Technician assign/reassign (staff only). Active techs loaded client-side,
  // mirroring the create form (CreateServiceTicketForm).
  const [technicians, setTechnicians] = useState<UserRow[]>([])
  const [assignedTechId, setAssignedTechId] = useState(ticket.assigned_technician_id ?? '')
  // Staff-editable billing type (warranty / non-warranty). The badge above shows
  // it at a glance; staff can correct a mis-keyed ticket here (API already allows
  // billing_type in STAFF_ALLOWED_FIELDS). Techs use the completion-form confirm.
  const [billingType, setBillingType] = useState<ServiceBillingType>(ticket.billing_type)
  // Staff-editable ticket type (inside/bench vs outside/field). Badge above shows
  // it at a glance; staff can correct a mis-keyed ticket here (API already allows
  // ticket_type in STAFF_ALLOWED_FIELDS). Switching to "outside" turns on the
  // service-address fields and the customer-signature requirement; switching to
  // "inside" makes the ticket eligible for the pickup queue.
  const [ticketType, setTicketType] = useState<ServiceTicketType>(ticket.ticket_type)
  // Staff-editable labor type (standard/industrial/vacuum) — corrects a
  // mis-keyed rate before the job is marked complete. The API already allows
  // labor_rate_type in STAFF_ALLOWED_FIELDS and /complete reads it fresh from
  // the DB row, so a correction made here flows straight into the final bill
  // (feedback #68). Locked once the ticket is completed/billed since the bill
  // is already computed by then.
  const [laborRateType, setLaborRateType] = useState(ticket.labor_rate_type ?? 'standard')
  useEffect(() => {
    setLaborRateType(ticket.labor_rate_type ?? 'standard')
  }, [ticket.labor_rate_type])
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
  // Fulfilled requested parts not yet copied onto the work order — backs the
  // "Copy Requested Parts" button below. Recomputed on every render so a part
  // that arrives (or gets copied) updates the button immediately.
  const copyableRequestedParts = fulfilledRequestedParts(partsRequested).filter(
    (r) => !completionParts.some((p) => partDedupeKey(p) === partDedupeKey(r))
  )
  function handleCopyRequestedParts() {
    const converted = partsFromSaved(
      copyableRequestedParts.map((r) => ({
        synergy_product_id: r.synergy_product_id ?? null,
        description: r.description,
        quantity: r.quantity,
        unit_price: r.unit_price ?? 0,
        detail: r.detail,
        product_number: r.product_number,
      }))
    )
    setCompletionParts((prev) => [...prev, ...converted])
  }
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')

  // ACE labor — tech-payout labor on no-charge work, captured at completion.
  const [aceLaborOpen, setAceLaborOpen] = useState(false)
  const [aceHours, setAceHours] = useState('')
  const [aceReason, setAceReason] = useState('')

  // Photos — state stays here (photos feeds auto-save + the completion
  // payload; uploading disables Mark Complete). Upload/delete UI lives in
  // ServicePhotosSection.
  const [photos, setPhotos] = useState<Array<TicketPhoto & { previewUrl?: string }>>(
    ticket.photos && ticket.photos.length > 0 ? ticket.photos : []
  )
  const [uploading, setUploading] = useState(false)

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

  // Auto-save — mirrors the PM pattern in src/app/tickets/[id]/TicketActions.tsx
  // (saveProgress + 3s debounce). Runs in two phases: the estimate-building
  // phase (estimate form open) and the in-progress completion phase.
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<() => void>(() => {})
  // Last server-known snapshot, so each save sends ONLY the fields THIS instance
  // changed — a concurrent stale writer can't clobber fields it never touched
  // (PM feedback #42/#43). Null until a baseline is captured for the active phase.
  const savedFieldsRef = useRef<Record<string, unknown> | null>(null)
  // Which phase the current baseline belongs to, so entering or switching phases
  // recaptures the baseline (and skips an auto-save on entry).
  const baselinePhaseRef = useRef<SavePhase | null>(null)

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

  // Problem description edit state — staff can amend the reported problem after submission
  const [editingProblem, setEditingProblem] = useState(false)
  const [problemDraft, setProblemDraft] = useState(ticket.problem_description)

  // Request More Info modal (manager-side, on Awaiting Approval state)
  const [requestInfoOpen, setRequestInfoOpen] = useState(false)
  // Bypass-estimate (pre-authorized work) modal — non-warranty open tickets
  const [bypassOpen, setBypassOpen] = useState(false)
  // Manager below-floor price approval prompt. Set with the server's violations
  // and a resolver so a save can await the manager's reason, then retry with the
  // override flag. Managers only (the server is the real gate).
  const [marginPrompt, setMarginPrompt] = useState<
    { violations: LineViolation[]; resolve: (note: string | null) => void } | null
  >(null)
  // Log-call inline form on the estimate card (estimated-state customer follow-up)
  const [estimateCallOpen, setEstimateCallOpen] = useState(false)
  const [estimateCallNotes, setEstimateCallNotes] = useState('')

  // Quick Complete bottom sheet (mobile, in_progress + viewer is assigned tech)
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
  const errorBannerRef = useRef<HTMLDivElement>(null)

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

  // Bring the error banner into view after a validation failure. The banner
  // sits near the top of a ~4,000px page while the completion submit is the
  // sticky "Mark Complete" bar at the bottom on a phone — without this, a
  // failed validation set the message far off-screen and looked like the tap
  // did nothing. Ticking a counter (rather than watching `error`) means a
  // repeat of the same message still scrolls.
  const [errorScrollTick, setErrorScrollTick] = useState(0)
  useEffect(() => {
    if (errorScrollTick > 0) {
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [errorScrollTick])
  function failValidation(msg: string) {
    setError(msg)
    setErrorScrollTick((t) => t + 1)
  }

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

  // Open the manager below-floor approval prompt and resolve with the typed
  // reason (or null if cancelled). Used by requestWithMarginOverride.
  function promptMarginOverride(violations: LineViolation[]): Promise<string | null> {
    return new Promise((resolve) => setMarginPrompt({ violations, resolve }))
  }

  // Fetch wrapper that handles the manager below-floor override. On a 15% margin
  // floor rejection (400 with `violations`, no `belowCost`), a MANAGER is asked
  // for a justification and the same request is retried with the override flag.
  // Everyone else (and the un-overridable below-cost case) gets the response
  // back unchanged for the caller's normal error handling.
  async function requestWithMarginOverride(
    url: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const doFetch = (extra: Record<string, unknown>) =>
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...extra }),
      })

    const res = await doFetch({})
    if (res.ok || !isManager || res.status !== 400) return res

    const data = await res.clone().json().catch(() => null)
    if (!Array.isArray(data?.violations) || data?.belowCost) return res

    const note = await promptMarginOverride(data.violations as LineViolation[])
    if (note == null) return res // cancelled — surface the original floor error
    return doFetch({ margin_override: true, margin_override_note: note })
  }

  async function patchTicket(body: Record<string, unknown>) {
    const res = await requestWithMarginOverride(`/api/service-tickets/${ticket.id}`, 'PATCH', body)
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
        // Tech-writable (in TECH_ALLOWED_FIELDS) — send unconditionally; the server
        // allowlist is the authority on who may write it. Gating it on isStaff here
        // silently dropped a tech's trip charge on submit (WO 816).
        trip_charge_qty: parseFloat(tripChargeQty) || 0,
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

  function handleReopenEstimate() {
    setPendingConfirm({
      title: 'Reopen estimate?',
      message:
        'Reopen this estimate for editing? The customer’s approval/signature ' +
        'will be cleared and you’ll need to re-send it for approval. ' +
        'The estimate numbers are kept.',
      confirmLabel: 'Reopen Estimate',
      action: () =>
        apiAction(async () => {
          const res = await fetch(`/api/service-tickets/${ticket.id}/reopen-estimate`, {
            method: 'POST',
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || 'Failed to reopen estimate')
          }
          setSuccessMsg('Estimate reopened for editing.')
        }),
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

  async function handleSaveProblem() {
    const problem = problemDraft.trim()
    // Column is NOT NULL — the Save button is disabled when empty, but guard anyway.
    if (!problem) return
    await apiAction(async () => {
      await patchTicket({ problem_description: problem })
      setProblemDraft(problem)
      setEditingProblem(false)
      setSuccessMsg('Problem description updated')
    })
  }

  function handleCancelProblemEdit() {
    setProblemDraft(ticket.problem_description)
    setEditingProblem(false)
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

  // ── Auto-save ──
  // Mirrors src/app/tickets/[id]/TicketActions.tsx saveProgress / debounce
  // pattern, extended to two phases: the estimate-building phase (form open,
  // pre-approval) and the in-progress completion phase. PATCHes only the
  // fields THIS instance changed so a refresh, in-app nav, or a second tab
  // can't drop or clobber work.
  type SavePhase = 'estimate' | 'completion'

  // Which phase is currently auto-saveable. Estimate building only happens in
  // the pre-work statuses while the form is open; completion only in_progress.
  // The two are mutually exclusive, so a single timer/baseline serves both.
  const estimatePhaseActive =
    showEstimateForm &&
    (ticket.status === SERVICE_STATUS.OPEN ||
      ticket.status === SERVICE_STATUS.ESTIMATED ||
      ticket.status === SERVICE_STATUS.DECLINED ||
      // Add-estimate-after-bypass: the builder can also be opened on an
      // in_progress ticket that was started without an estimate.
      (ticket.status === SERVICE_STATUS.IN_PROGRESS && ticket.estimate_bypassed))
  // Completion auto-save yields to the estimate builder when it's open (the two
  // are mutually exclusive), so a bypassed ticket mid-estimate doesn't also try
  // to auto-save completion fields.
  const completionPhaseActive =
    ticket.status === SERVICE_STATUS.IN_PROGRESS && !estimatePhaseActive
  const autoSavePhase: SavePhase | null = estimatePhaseActive
    ? 'estimate'
    : completionPhaseActive
      ? 'completion'
      : null

  // Normalized snapshot of the saveable fields for a phase. Diffed against the
  // last server-known baseline to find what changed. Estimate auto-save sends a
  // DRAFT only — never `status` — so the explicit "Submit Estimate" button keeps
  // ownership of the status transition (and any under-$100 auto-approval).
  const currentSaveFields = (phase: SavePhase): Record<string, unknown> => {
    if (phase === 'estimate') {
      return {
        diagnosis_notes: diagnosisNotes || null,
        estimate_labor_hours: parseFloat(estimateLaborHours) || null,
        estimate_parts: estimateParts.length > 0 ? toServicePartUsed(estimateParts) : [],
        // Staff-only field — server filters it out for techs.
        ...(isStaff ? { labor_rate_type: estimateRateType } : {}),
        // Tech-writable (in TECH_ALLOWED_FIELDS) — send unconditionally; server allowlist gates it.
        trip_charge_qty: parseFloat(tripChargeQty) || 0,
      }
    }
    return {
      hours_worked: parseFloat(hoursWorked) || null,
      completion_notes: completionNotes || null,
      parts_used: completionParts.length > 0 ? toServicePartUsed(completionParts) : [],
      photos: photos.map(({ storage_path, uploaded_at }) => ({ storage_path, uploaded_at })),
      // Trip charge qty lives inline under Hours Worked; persist edits so a refresh
      // doesn't drop them. Tech-writable (in TECH_ALLOWED_FIELDS) — send
      // unconditionally; the server allowlist is the authority on who may write it.
      trip_charge_qty: parseFloat(tripChargeQty) || 0,
    }
  }

  async function saveProgress(opts?: { keepalive?: boolean }) {
    if (!autoSavePhase) return
    // Diff the current snapshot against the last server-known baseline and send
    // ONLY changed keys, so a concurrent stale writer can't overwrite untouched
    // fields (PM feedback #42/#43).
    const fields = currentSaveFields(autoSavePhase)
    const baseline = savedFieldsRef.current ?? {}
    const dirty: Record<string, unknown> = {}
    for (const key of Object.keys(fields)) {
      if (JSON.stringify(fields[key]) !== JSON.stringify(baseline[key])) {
        dirty[key] = fields[key]
      }
    }
    if (Object.keys(dirty).length === 0) {
      // Nothing changed here — leave the row untouched (writing it would clobber
      // another writer's fields).
      if (!opts?.keepalive) {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
      return
    }

    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: opts?.keepalive ?? false,
        body: JSON.stringify(dirty),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Background auto-save: a below-floor draft is expected while a manager is
        // still entering parts — don't flash an error or pop the approval prompt.
        // The explicit Complete/estimate submit is where the override is handled.
        if (Array.isArray(data?.violations)) return
        throw new Error(data.error || 'Failed to save progress')
      }
      // Persist succeeded — advance the baseline to what we just sent so later
      // edits diff against it. (On failure we leave it alone so the same fields
      // retry next save.)
      savedFieldsRef.current = fields
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      // The server round-trip landed for the completion phase — the local
      // draft's job (surviving a save the server never saw) is done. Server
      // stays authoritative; the estimate phase never touches this draft.
      if (autoSavePhase === 'completion') clearLocalDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  // Auto-save: debounce 3 seconds after any saveable field change while a phase
  // is active (estimate building or in-progress completion). On first entry to a
  // phase (or when switching phases), capture the baseline and skip the save so
  // edits diff against the loaded state, not the component's first render.
  useEffect(() => {
    if (!autoSavePhase) return
    if (baselinePhaseRef.current !== autoSavePhase) {
      baselinePhaseRef.current = autoSavePhase
      savedFieldsRef.current = currentSaveFields(autoSavePhase)
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
  }, [
    // Completion-phase fields
    hoursWorked, completionNotes, completionParts, photos,
    // Estimate-phase fields
    diagnosisNotes, estimateLaborHours, estimateParts, estimateRateType,
    // Shared
    tripChargeQty, autoSavePhase,
  ])

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

  // Local draft — offline safety net for the completion form only (mirrors
  // src/app/tickets/[id]/TicketActions.tsx). The 3s server autosave above is
  // still authoritative; this only exists so a tech who loses signal
  // mid-completion doesn't lose the form on refresh. Keyed by ticket id, and
  // only enabled during the completion phase (not the estimate builder).
  const serviceCompletionDraftState = useMemo<ServiceCompletionDraft>(() => ({
    billingType, hoursWorked, tripChargeQty, machineHours, dateCode,
    completionNotes, completionParts, aceLaborOpen, aceHours, aceReason,
  }), [
    billingType, hoursWorked, tripChargeQty, machineHours, dateCode,
    completionNotes, completionParts, aceLaborOpen, aceHours, aceReason,
  ])

  const { clearDraft: clearLocalDraft, lastPersistedAt: localDraftPersistedAt } = useFormDraft<ServiceCompletionDraft>({
    key: `service-completion-${ticket.id}`,
    state: serviceCompletionDraftState,
    enabled: completionPhaseActive,
    isMeaningful: (s) =>
      Boolean(
        s.hoursWorked.trim() ||
        (parseFloat(s.tripChargeQty) || 0) > 0 ||
        s.machineHours.trim() ||
        s.dateCode.trim() ||
        s.completionNotes.trim() ||
        s.completionParts.length > 0 ||
        s.aceLaborOpen
      ),
    onRestore: (draft, lastEditedAt) => {
      // Server autosave (or a completed save from another session) may already
      // be newer than this device's local draft — never regress a fresher
      // server value with a stale local one.
      const serverLastSaved = new Date(ticket.updated_at).getTime()
      if (!Number.isFinite(lastEditedAt) || lastEditedAt <= serverLastSaved) return
      if (draft.billingType) setBillingType(draft.billingType)
      setHoursWorked(draft.hoursWorked ?? '')
      setTripChargeQty(draft.tripChargeQty ?? tripChargeQty)
      setMachineHours(draft.machineHours ?? '')
      setDateCode(draft.dateCode ?? '')
      setCompletionNotes(draft.completionNotes ?? '')
      if (draft.completionParts) {
        setCompletionParts(draft.completionParts.map((p) => ({ ...p, searchOpen: false, searching: false })))
      }
      setAceLaborOpen(Boolean(draft.aceLaborOpen))
      setAceHours(draft.aceHours ?? '')
      setAceReason(draft.aceReason ?? '')
    },
  })

  // "Saved on this device" — driven by the local write succeeding, distinct
  // from `saveSuccess` (server PATCH landed). Server indicator wins when both
  // are true; see CompletionSection's saveSuccess prop below.
  const [localSavedVisible, setLocalSavedVisible] = useState(false)
  useEffect(() => {
    if (localDraftPersistedAt == null) return
    setLocalSavedVisible(true)
    const t = setTimeout(() => setLocalSavedVisible(false), 3000)
    return () => clearTimeout(t)
  }, [localDraftPersistedAt])

  async function handleRequestEstimatePart(index: number) {
    const entry = estimateParts[index]
    if (!entry || !entry.description.trim() || entry.alreadyRequested) return
    const priceParsed = parseFloat(entry.unitPrice)
    // Hardening: if the estimate entry has no sourcing data (e.g. a legacy
    // snapshot saved before toServicePartUsed carried these fields, or a hard
    // reopen that cleared estimate_parts and the tech rebuilt the line by hand),
    // fall back to an existing parts_requested line for the same part so a
    // re-request never downgrades vendor linkage the office already captured.
    // Match on the Synergy product id when present, else on description.
    const priorMatch = partsRequested.find((p) =>
      entry.synergyProductId != null
        ? p.synergy_product_id === entry.synergyProductId
        : (p.description ?? '').trim().toLowerCase() === entry.description.trim().toLowerCase()
    )
    const productNumber = entry.productNumber?.trim() || priorMatch?.product_number || undefined
    const vendorItemCode = entry.vendorItemCode?.trim() || priorMatch?.vendor_item_code || undefined
    const vendor = entry.vendor?.trim() || priorMatch?.vendor || undefined
    const vendorCode = entry.vendorCode?.trim() || priorMatch?.vendor_code || undefined
    const newPart: PartRequest = {
      description: entry.description.trim(),
      quantity: Number(entry.quantity) || 1,
      product_number: productNumber,
      synergy_product_id: entry.synergyProductId ?? undefined,
      vendor_item_code: vendorItemCode,
      vendor: vendor,
      vendor_code: vendorCode,
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

  // Estimate lines quoted but never handed to the parts queue — the manual seam
  // where the office re-keyed each quoted part after approval. Identity-matched
  // the same way handleRequestEstimatePart's vendor fallback matches: Synergy
  // product id when present, else case-insensitive description. Cancelled
  // requests still count as handled so a deliberate office cancel is never
  // silently re-added by the bulk promote.
  const unpromotedEstimateParts = (ticket.estimate_parts ?? []).filter((ep) => {
    if (!ep.description?.trim()) return false
    return !partsRequested.some((p) =>
      ep.synergy_product_id != null
        ? p.synergy_product_id === ep.synergy_product_id
        : (p.description ?? '').trim().toLowerCase() === ep.description.trim().toLowerCase()
    )
  })

  // Post-approval only: before the customer approves, quoted parts don't belong
  // in review (the estimate builder's per-row Request covers deliberate early
  // ordering), and after completion the parts section is read-only anyway.
  const canPromoteEstimateParts =
    (ticket.status === 'approved' || ticket.status === 'in_progress') &&
    unpromotedEstimateParts.length > 0

  // One-click promote of the approved estimate's quoted parts into the parts
  // queue — each lands as pending_review, identical to a hand-keyed request.
  // A manual (off-catalog) line missing vendor info can't pass the server's
  // new-request validation, so it's skipped with a note instead of failing the
  // whole batch.
  async function handlePromoteEstimateParts() {
    if (!canPromoteEstimateParts) return
    const promotable = unpromotedEstimateParts.filter(
      (ep) =>
        ep.synergy_product_id != null ||
        (!!ep.vendor?.trim() &&
          !!ep.vendor_item_code?.trim() &&
          Number.isFinite(ep.unit_price) &&
          ep.unit_price >= 0)
    )
    const skipped = unpromotedEstimateParts.length - promotable.length
    if (promotable.length === 0) {
      setError(
        'None of the estimate parts have the vendor info needed to request them — add them individually with + Request Part.'
      )
      return
    }
    const nowIso = new Date().toISOString()
    const newParts: PartRequest[] = promotable.map((ep) => ({
      description: ep.description.trim(),
      quantity: ep.quantity || 1,
      product_number: ep.product_number?.trim() || undefined,
      synergy_product_id: ep.synergy_product_id ?? undefined,
      vendor_item_code: ep.vendor_item_code?.trim() || undefined,
      vendor: ep.vendor?.trim() || undefined,
      vendor_code: ep.vendor_code?.trim() || undefined,
      unit_price: Number.isFinite(ep.unit_price) ? ep.unit_price : undefined,
      status: 'pending_review',
      requested_at: nowIso,
    }))
    const updatedRequests = [...partsRequested, ...newParts]
    await apiAction(async () => {
      await patchTicket({ parts_requested: updatedRequests })
      setPartsRequested(updatedRequests)
      setSuccessMsg(
        `${newParts.length} estimate part${newParts.length === 1 ? '' : 's'} sent to parts review.` +
          (skipped > 0
            ? ` ${skipped} skipped — missing vendor info; add ${skipped === 1 ? 'it' : 'them'} with + Request Part.`
            : '')
      )
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

  // Drop an un-ordered part request off the ticket. Only offered for
  // pending_review/requested parts (see the gated button). We SOFT-cancel the
  // element in place rather than splicing it out: the Parts Queue addresses each
  // part by its position in this array (parts_order_queue.part_index = array
  // ordinal), so removing an element reindexes every later part and strands the
  // queue's reference to any ordered sibling that followed it — the "part_index
  // out of range" bug from feedback #64. Marking it cancelled keeps positions
  // stable; cancelled parts already drop off every queue tab and the
  // parts_received recompute, and render here as a struck-through tombstone.
  async function handleRemovePartRequest(index: number) {
    const now = new Date().toISOString()
    const updatedParts = partsRequested.map((p, i) =>
      i === index
        ? { ...p, cancelled: true, cancel_reason: 'Removed from ticket', cancelled_at: now, cancelled_by: userId }
        : p
    )
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
      failValidation('Verify the equipment details above before completing.')
      return
    }

    const signatureRequired = ticket.ticket_type !== 'inside'
    if (signatureRequired && (!signatureImage || !signatureName.trim())) {
      failValidation('Customer signature and printed name are required.')
      return
    }

    const hours = parseFloat(hoursWorked)
    if (isNaN(hours) || hours < 0) {
      failValidation('Please enter valid hours worked.')
      return
    }

    if (aceLaborOpen) {
      const aceH = parseFloat(aceHours)
      if (!Number.isFinite(aceH) || aceH <= 0) {
        failValidation('ACE hours must be greater than 0, or remove the ACE Labor section.')
        return
      }
      if (!aceReason.trim()) {
        failValidation('ACE Labor reason is required.')
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
      const res = await requestWithMarginOverride(`/api/service-tickets/${ticket.id}/complete`, 'POST', {
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
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to complete ticket')
      }
      setCompleted(true)
      clearLocalDraft()
    })
  }

  async function handleMarkBilled() {
    if (!synergyInvoiceNumber.trim()) {
      failValidation('Synergy invoice number is required to mark as billed')
      return
    }
    // A PO-required customer can't be billed without a PO on the ticket. The
    // Ready-to-Export gate was relaxed (the Synergy order can be built before the
    // PO arrives), so the PO requirement lands here at billing. The server PATCH
    // route enforces this too; this pre-check gives an immediate message.
    if (ticket.customers?.po_required && !ticket.po_number) {
      failValidation('A PO number is required before this ticket can be billed')
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

  function handleReopen() {
    // Reopen from a worked state (in_progress/completed/billed) on a ticket
    // whose estimate was already approved drops back to 'approved' so the
    // estimate + approval survive and only completion data is cleared.
    // Everything else (declined-revise, canceled, or worked tickets without
    // an approved estimate) keeps the original wipe-to-'open' behavior.
    //
    // Bypassed tickets ("started without an estimate") are excluded: their
    // estimate_approved=true is just the pre-authorized marker, not a real
    // customer sign-off, and there's no estimate to preserve — so reopening
    // them lands at 'open' (clearing the bypass flag) instead of leaving a
    // hollow "Approved" status behind.
    const reopenToApproved =
      ticket.estimate_approved &&
      !ticket.estimate_bypassed &&
      (ticket.status === SERVICE_STATUS.IN_PROGRESS ||
        ticket.status === SERVICE_STATUS.COMPLETED ||
        ticket.status === SERVICE_STATUS.BILLED)
    const message = reopenToApproved
      ? 'Reopen this ticket? Completion data will be cleared. The estimate and approval will be kept.'
      : 'Reopen this ticket? Completion data will be cleared.'
    setPendingConfirm({
      title: 'Reopen ticket?',
      message,
      confirmLabel: 'Reopen',
      action: () =>
        apiAction(async () => {
          await patchTicket({ status: reopenToApproved ? 'approved' : 'open' })
        }),
    })
  }

  function handleCancel() {
    setPendingConfirm({
      title: 'Cancel ticket?',
      message: 'Cancel this ticket? It stays visible and editable on the boards but is marked Canceled. You can reopen it later.',
      confirmLabel: 'Cancel Ticket',
      action: () =>
        apiAction(async () => {
          await patchTicket({ status: 'canceled' })
        }),
    })
  }

  function handleDelete() {
    setPendingConfirm({
      title: 'Delete ticket?',
      message: 'Delete this ticket? It will be hidden from boards, billing, and PDFs. A manager can restore it later.',
      confirmLabel: 'Delete',
      action: async () => {
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
      },
    })
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
  const partsOnOrderList = partsOnOrder(partsRequested)
  const partsWaitingCount = partsOnOrderList.length
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
  // Diagnostic fee mirrors the server: a separately-invoiced diagnostic (has an
  // invoice number) is a credit (subtracted) so the customer isn't double-billed;
  // otherwise it's a normal added charge.
  const diagnosticChargeNum = Number(ticket.diagnostic_charge ?? 0) || 0
  const signedDiagnosticNum = String(ticket.diagnostic_invoice_number ?? '').trim()
    ? -diagnosticChargeNum
    : diagnosticChargeNum
  const billingTotal = ticket.billing_type === 'warranty' ? 0 : laborTotal + partsTotal + tripChargeNum + signedDiagnosticNum
  // Sales tax (parts only, display-only) — mirrors the work-order PDF so the
  // on-screen total matches what the customer sees. 0 on warranty (no parts billed).
  const taxRateFraction = (taxRatePercent ?? 0) / 100
  const billTaxAmount = ticket.billing_type === 'warranty' ? 0 : computePartsTax(partsTotal, taxRateFraction)

  // Estimate computed totals. The rate type can be re-picked in the builder, so the
  // preview uses the resolved rate for the selected type (server re-snapshots on submit).
  const effectiveEstRate = laborRates?.[estimateRateType] ?? laborRate
  const estLaborTotal = (parseFloat(estimateLaborHours) || 0) * effectiveEstRate
  const estPartsTotal = estimateParts
    .filter((p) => !p.warrantyCovered)
    .reduce((sum, p) => sum + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0), 0)
  const estTotal = ticket.billing_type === 'warranty' ? 0 : estLaborTotal + estPartsTotal + tripChargeNum
  const estTaxAmount = ticket.billing_type === 'warranty' ? 0 : computePartsTax(estPartsTotal, taxRateFraction)

  // Sales tax for the READ-ONLY summary cards (saved estimate / completed billing),
  // computed from the persisted parts so the on-screen review matches the PDF.
  const savedEstPartsSubtotal = (ticket.estimate_parts ?? [])
    .filter((p) => !p.warranty_covered)
    .reduce((sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
  const savedEstTax = ticket.billing_type === 'warranty' ? 0 : computePartsTax(savedEstPartsSubtotal, taxRateFraction)
  const savedBillPartsSubtotal = (ticket.parts_used ?? [])
    .filter((p) => !p.warranty_covered)
    .reduce((sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
  const savedBillTax = ticket.billing_type === 'warranty' ? 0 : computePartsTax(savedBillPartsSubtotal, taxRateFraction)

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

  // The verify panel lives in the estimate builder (OPEN) and the completion
  // form (IN_PROGRESS). The estimated/approved/declined window had no panel, so
  // the parts-gate banner pointed "above" to a verify step that wasn't rendered
  // there. Surface the same panel in the Diagnosis & Estimate card for those
  // middle statuses (OPEN/IN_PROGRESS excluded — they already render it, so no
  // double-panel).
  const showEstimateCardVerify =
    needsEquipmentVerify &&
    (ticket.status === SERVICE_STATUS.ESTIMATED ||
      ticket.status === SERVICE_STATUS.APPROVED ||
      ticket.status === SERVICE_STATUS.DECLINED)

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

  // ── Next Step bar ──
  // One contextual primary action per stage, surfaced at the top so the
  // viewer never hunts for "what's next". The same booleans gate the bar's
  // visibility AND suppress the WorkflowStatusCard "Next:" line when the
  // viewer has a button (so we don't show "Next: Build the estimate" right
  // above a "Build Estimate" button).
  const partsBlocking = livePartsRequested.length > 0 && !allPartsReceived
  // Pending parts that withhold Start Work, grouped by label for the
  // blocked-state callout (feedback #71). Before this, an approved ticket with
  // parts still pending simply hid the Start Work button, so a tech had no idea
  // their own pending part requests were the blocker — or that they could
  // remove them. Counts lines (matches partsWaitingCount), not quantities.
  const blockingPartsSummary: Array<[string, number]> = partsBlocking
    ? Object.entries(
        partsOnOrderList.reduce<Record<string, number>>((acc, p) => {
          const label = partLabel(p) || 'Part'
          acc[label] = (acc[label] ?? 0) + 1
          return acc
        }, {}),
      )
    : []
  const isWarrantyOpen =
    ticket.status === SERVICE_STATUS.OPEN &&
    (ticket.billing_type === 'warranty' || ticket.billing_type === 'partial_warranty')
  const viewerHasPrimaryAction =
    isWarrantyOpen ||
    (ticket.status === SERVICE_STATUS.OPEN && !showEstimateForm) ||
    (ticket.status === SERVICE_STATUS.ESTIMATED && (isStaff || isTech)) ||
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
    isMobile && !showEstimateForm && !showCompletionForm && (
      isWarrantyOpen ||
      (ticket.status === SERVICE_STATUS.OPEN && !isWarrantyOpen) ||
      (ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking) ||
      ticket.status === SERVICE_STATUS.IN_PROGRESS
    )

  // Sticky "Mark Complete" bar shown on a phone once the full completion form
  // is open, so the tech can submit without scrolling to the bottom. Gated off
  // needsEquipmentVerify so it doesn't appear while the verify panel is up
  // instead of the form. Submits the form via the `form` attribute.
  const showMobileCompletionBar =
    isMobile &&
    ticket.status === SERVICE_STATUS.IN_PROGRESS &&
    showCompletionForm &&
    !needsEquipmentVerify

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div className={`space-y-6 ${showMobileActionBar || showMobileCompletionBar ? 'pb-24' : ''}`}>
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

          {/* Ticket type — correct a mis-keyed inside/outside ticket. Switching
              to Outside turns on the service-address fields and the customer
              signature requirement; switching to Inside makes it eligible for
              the pickup queue. */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex-1">
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                Ticket Type
              </label>
              <select
                value={ticketType}
                onChange={(e) => setTicketType(e.target.value as ServiceTicketType)}
                disabled={loading}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0 disabled:opacity-50"
              >
                <option value="inside">Inside (Shop)</option>
                <option value="outside">Outside (Field)</option>
              </select>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Inside = bench/shop repair. Outside = field service (adds address + signature).
              </p>
            </div>
            <button
              onClick={() =>
                apiAction(async () => {
                  await patchTicket({ ticket_type: ticketType })
                  setSuccessMsg('Ticket type updated')
                })
              }
              disabled={loading || ticketType === ticket.ticket_type}
              className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>

          {/* Labor type — correct a mis-keyed labor rate before the job is
              marked complete. Locked once completed/billed: the bill is
              already computed by then, so changing it here would no longer
              do anything (feedback #68). */}
          {(() => {
            const laborTypeLocked =
              ticket.status === SERVICE_STATUS.COMPLETED || ticket.status === SERVICE_STATUS.BILLED
            return (
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <div className="flex-1">
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
                    Labor Type
                  </label>
                  <select
                    value={laborRateType}
                    onChange={(e) => setLaborRateType(e.target.value)}
                    disabled={loading || laborTypeLocked}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0 disabled:opacity-50"
                  >
                    <option value="standard">Standard</option>
                    <option value="industrial">Industrial</option>
                    <option value="vacuum">Vacuum</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {laborTypeLocked
                      ? 'Locked once the ticket is completed/billed.'
                      : 'Drives the labor rate used on the estimate and final bill.'}
                  </p>
                </div>
                <button
                  onClick={() =>
                    apiAction(async () => {
                      await patchTicket({ labor_rate_type: laborRateType })
                      setSuccessMsg('Labor type updated')
                    })
                  }
                  disabled={loading || laborTypeLocked || laborRateType === (ticket.labor_rate_type ?? 'standard')}
                  className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            )
          })()}
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
        <div ref={errorBannerRef} className="scroll-mt-20">
          <InlineError message={error} />
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
              {getStatusMeta('creditReview', 'blocked').label} — manager release required.
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
      {viewerHasPrimaryAction && !showMobileActionBar && (
        <NextStepBar
          ticket={ticket}
          isManager={isManager}
          isStaff={isStaff}
          isTech={isTech}
          loading={loading}
          isWarrantyOpen={isWarrantyOpen}
          partsBlocking={partsBlocking}
          showEstimateForm={showEstimateForm}
          setShowEstimateForm={setShowEstimateForm}
          showCompletionForm={showCompletionForm}
          setShowCompletionForm={setShowCompletionForm}
          setBypassOpen={setBypassOpen}
          setRequestInfoOpen={setRequestInfoOpen}
          manualDecisionMode={manualDecisionMode}
          setManualDecisionMode={setManualDecisionMode}
          manualDecisionNote={manualDecisionNote}
          setManualDecisionNote={setManualDecisionNote}
          synergyInvoiceNumber={synergyInvoiceNumber}
          onStartWork={handleStartWork}
          onApproveEstimate={handleApproveEstimate}
          onDeclineEstimate={handleDeclineEstimate}
          onSaveSynergyInvoiceNumber={handleSaveSynergyInvoiceNumber}
          onMarkBilled={handleMarkBilled}
        />
      )}

      {/* Parts-blocked Next Step (feedback #71). An approved ticket with parts
          still pending withholds Start Work — but the button used to just
          vanish, so a tech (Richard Bryant) had no idea the SHOP SUPPLIES lines
          he'd added were the blocker, or that he could remove them; a manager
          had to cancel them before he could complete. Render an explicit,
          actionable callout in the same slot the Start Work button would take,
          on both desktop and mobile (viewerHasPrimaryAction is false here, so
          neither the top bar nor the mobile bar renders). */}
      {ticket.status === SERVICE_STATUS.APPROVED && partsBlocking && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 shadow-sm p-4 sm:p-5 space-y-2">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            Next Step
          </p>
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Can’t start work yet — {partsWaitingCount} part request{partsWaitingCount === 1 ? '' : 's'} still pending in the Parts section below.
              </p>
              {blockingPartsSummary.length > 0 && (
                <ul className="text-sm text-amber-800 dark:text-amber-200 list-disc list-inside">
                  {blockingPartsSummary.slice(0, 6).map(([label, count]) => (
                    <li key={label}>
                      {label}{count > 1 ? ` ×${count}` : ''}
                    </li>
                  ))}
                  {blockingPartsSummary.length > 6 && (
                    <li>+{blockingPartsSummary.length - 6} more</li>
                  )}
                </ul>
              )}
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {isStaff
                  ? 'Order and receive them below, or remove any that aren’t needed — then Start Work appears.'
                  : 'Remove any you don’t need below (trash icon), or wait for the office to order and receive them — then Start Work appears.'}
              </p>
            </div>
          </div>
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
            {isManager && ticket.customer_id != null && (
              <ChangeBillToSection
                billToUrl={`/api/service-tickets/${ticket.id}/bill-to`}
                currentCustomerId={ticket.customer_id}
                currentLabel={
                  ticket.customers?.account_number
                    ? `${ticket.customers?.name ?? 'Unknown'} (${ticket.customers.account_number})`
                    : ticket.customers?.name ?? 'Unknown'
                }
                locked={!!(ticket.synergy_order_number || ticket.synergy_invoice_number)}
              />
            )}
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
          {/* Ship-to set directly on the ticket (no linked equipment — e.g. Synergy imports).
              Equipment-linked tickets manage their location via the relocate control above. */}
          {!ticket.equipment_id && (
            <InfoField label="Location">
              {ticket.ship_to_location
                ? [
                    ticket.ship_to_location.name,
                    ticket.ship_to_location.address,
                    ticket.ship_to_location.city,
                    ticket.ship_to_location.state,
                    ticket.ship_to_location.zip,
                  ].filter(Boolean).join(', ')
                : '—'}
              {isStaff &&
                !['completed', 'billed', 'declined', 'canceled'].includes(ticket.status) && (
                  <div className="mt-2">
                    <ChangeLocationSection
                      ticketId={ticket.id}
                      customerId={ticket.customer_id}
                      equipmentId={null}
                      currentShipToId={ticket.ship_to_location_id ?? null}
                      relocateUrl={`/api/service-tickets/${ticket.id}/relocate`}
                      patchUrl={`/api/service-tickets/${ticket.id}`}
                      applyMode="set-ticket-shipto"
                      requestTicketField="service_ticket_id"
                    />
                  </div>
                )}
            </InfoField>
          )}
          <InfoField label="Serial Number">
            {equipSerial ?? '—'}
          </InfoField>
          {/* Contact — staff and the assigned tech can edit. A tech needs to add
              a customer email here to email the estimate themselves (feedback #61);
              ownership is enforced server-side by the ticket PATCH route. */}
          {(isStaff || isTech) ? (
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
        {isStaff && editingProblem ? (
          <div className="space-y-2">
            <textarea
              value={problemDraft}
              onChange={(e) => setProblemDraft(e.target.value)}
              rows={4}
              placeholder="Describe the reported problem"
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveProblem}
                disabled={loading || !problemDraft.trim() || problemDraft.trim() === ticket.problem_description}
                className="px-3 py-1.5 text-xs font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleCancelProblemEdit}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <p className="flex-1 min-w-0 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
              {ticket.problem_description}
            </p>
            {isStaff && (
              <button
                type="button"
                onClick={() => setEditingProblem(true)}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ── Section 4: Diagnosis & Estimate ──
          Renders once an estimate exists, the ticket is past the estimate
          stage, or the builder is open (triggered from the Next Step bar).
          A fresh `open` ticket shows no empty estimate card. */}
      {(ticket.status === SERVICE_STATUS.ESTIMATED || ticket.status === SERVICE_STATUS.APPROVED ||
        ticket.status === SERVICE_STATUS.DECLINED || ticket.estimate_amount != null || showEstimateForm) && (
        <div ref={estimateCardRef}>
        <EstimateSection
          ticket={ticket}
          isManager={isManager}
          isStaff={isStaff}
          isTech={isTech}
          loading={loading}
          saving={saving}
          saveSuccess={saveSuccess}
          canEmailEstimate={canEmailEstimate}
          taxRatePercent={taxRatePercent}
          laborRates={laborRates}
          tripChargeRate={tripChargeRate}
          estimateOpen={estimateOpen}
          savedEstTax={savedEstTax}
          showEstimateCardVerify={showEstimateCardVerify}
          equipmentToVerify={equipmentToVerify}
          onEquipmentVerified={handleEquipmentVerified}
          showEstimateForm={showEstimateForm}
          setShowEstimateForm={setShowEstimateForm}
          estimateRateType={estimateRateType}
          setEstimateRateType={setEstimateRateType}
          estimateLaborHours={estimateLaborHours}
          setEstimateLaborHours={setEstimateLaborHours}
          tripChargeQty={tripChargeQty}
          setTripChargeQty={setTripChargeQty}
          estimateParts={estimateParts}
          setEstimateParts={setEstimateParts}
          machineComplete={machineComplete}
          onRequestEstimatePart={handleRequestEstimatePart}
          diagnosisNotes={diagnosisNotes}
          setDiagnosisNotes={setDiagnosisNotes}
          effectiveEstRate={effectiveEstRate}
          estLaborTotal={estLaborTotal}
          estPartsTotal={estPartsTotal}
          estTotal={estTotal}
          estTaxAmount={estTaxAmount}
          tripChargeNum={tripChargeNum}
          tripChargeQtyNum={tripChargeQtyNum}
          estimateCallOpen={estimateCallOpen}
          setEstimateCallOpen={setEstimateCallOpen}
          estimateCallNotes={estimateCallNotes}
          setEstimateCallNotes={setEstimateCallNotes}
          onSubmitEstimate={handleSubmitEstimate}
          onDownloadEstimate={handleDownloadEstimate}
          onEmailEstimate={handleEmailEstimate}
          onReopenEstimate={handleReopenEstimate}
          onLogEstimateCall={handleLogEstimateCall}
          onSaveDraft={() => {
            if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
            void saveProgress()
          }}
          onSuccessMsg={setSuccessMsg}
        />
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
          validationStatus={ticket.diagnostic_invoice_validation_status}
        />
      )}

      {/* ── Section 5: Parts Requested ──
          Collapsible. Stays open whenever something needs attention
          (status is pre-completion AND not all parts received). Auto-closes
          once everything is received so the tech doesn't scroll past it. */}
      {(partsRequested.length > 0 || (ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled')) && (
        <PartsSection
          ticket={ticket}
          isManager={isManager}
          isStaff={isStaff}
          isTech={isTech}
          loading={loading}
          partsRequested={partsRequested}
          livePartsRequested={livePartsRequested}
          partsReceivedCount={partsReceivedCount}
          allPartsReceived={allPartsReceived}
          poDueDates={poDueDates}
          machineComplete={machineComplete}
          synergyOrderNumber={synergyOrderNumber}
          canPromoteEstimateParts={canPromoteEstimateParts}
          unpromotedEstimatePartsCount={unpromotedEstimateParts.length}
          showAddPart={showAddPart}
          setShowAddPart={setShowAddPart}
          newPartDesc={newPartDesc}
          setNewPartDesc={setNewPartDesc}
          newPartQty={newPartQty}
          setNewPartQty={setNewPartQty}
          newPartNumber={newPartNumber}
          setNewPartNumber={setNewPartNumber}
          newPartVendorItemCode={newPartVendorItemCode}
          setNewPartVendorItemCode={setNewPartVendorItemCode}
          newPartVendor={newPartVendor}
          setNewPartVendor={setNewPartVendor}
          newPartVendorCode={newPartVendorCode}
          setNewPartVendorCode={setNewPartVendorCode}
          newPartPrice={newPartPrice}
          setNewPartPrice={setNewPartPrice}
          newPartSynergyProductId={newPartSynergyProductId}
          newPartIsCatalog={newPartIsCatalog}
          addPartReady={addPartReady}
          partSearch={partSearch}
          partComboRef={partComboRef}
          setPartComboOpen={setPartComboOpen}
          onRemovePartRequest={handleRemovePartRequest}
          onUpdatePartStatus={handleUpdatePartStatus}
          onResetPartStatus={handleResetPartStatus}
          onSavePartSynergy={handleSavePartSynergy}
          onUpdatePartVendorItemCode={handleUpdatePartVendorItemCode}
          onSavePartVendorItemCode={handleSavePartVendorItemCode}
          onUpdatePartPo={handleUpdatePartPo}
          onSavePartPo={handleSavePartPo}
          onEquipmentVerified={handleEquipmentVerified}
          onPromoteEstimateParts={handlePromoteEstimateParts}
          onSelectCatalogPart={selectCatalogPart}
          onClearCatalogPart={clearCatalogPart}
          onResetAddPartForm={resetAddPartForm}
          onAddPartRequest={handleAddPartRequest}
          onSaveSynergyOrderNumber={handleSaveSynergyOrderNumber}
        />
      )}

      {/* ── Section 7: Completion Form ──
          Collapsible — opens by default in_progress; on mobile it's also the
          only open section. */}
      {ticket.status === SERVICE_STATUS.IN_PROGRESS && showCompletionForm && (
        <div ref={completionCardRef}>
        <CompletionSection
          ticket={ticket}
          isStaff={isStaff}
          isTech={isTech}
          loading={loading}
          saving={saving}
          saveSuccess={saveSuccess}
          localSavedVisible={localSavedVisible}
          taxRatePercent={taxRatePercent}
          laborRate={laborRate}
          tripChargeRate={tripChargeRate}
          completionOpen={completionOpen}
          equipmentToVerify={equipmentToVerify}
          onEquipmentVerified={handleEquipmentVerified}
          billingType={billingType}
          setBillingType={setBillingType}
          hoursWorked={hoursWorked}
          setHoursWorked={setHoursWorked}
          tripChargeQty={tripChargeQty}
          setTripChargeQty={setTripChargeQty}
          machineHours={machineHours}
          setMachineHours={setMachineHours}
          dateCode={dateCode}
          setDateCode={setDateCode}
          completionParts={completionParts}
          setCompletionParts={setCompletionParts}
          copyableRequestedPartsCount={copyableRequestedParts.length}
          completionNotes={completionNotes}
          setCompletionNotes={setCompletionNotes}
          aceLaborOpen={aceLaborOpen}
          setAceLaborOpen={setAceLaborOpen}
          aceHours={aceHours}
          setAceHours={setAceHours}
          aceReason={aceReason}
          setAceReason={setAceReason}
          setSignatureImage={setSignatureImage}
          setSignatureName={setSignatureName}
          photos={photos}
          setPhotos={setPhotos}
          uploading={uploading}
          setUploading={setUploading}
          onError={setError}
          laborTotal={laborTotal}
          partsTotal={partsTotal}
          billingTotal={billingTotal}
          billTaxAmount={billTaxAmount}
          tripChargeNum={tripChargeNum}
          tripChargeQtyNum={tripChargeQtyNum}
          onComplete={handleComplete}
          onCopyRequestedParts={handleCopyRequestedParts}
        />
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
            {savedBillTax > 0 && (
              <>
                <InfoField label={`Sales Tax (${taxRatePercent}%)`}>
                  ${savedBillTax.toFixed(2)}
                </InfoField>
                <InfoField label="Customer Total (with tax)">
                  ${((ticket.billing_amount ?? 0) + savedBillTax).toFixed(2)}
                </InfoField>
              </>
            )}
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
                title="Mark the ticket Canceled. It stays visible and editable on the boards and can be reopened."
                className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
              >
                Cancel Ticket
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={loading}
              title="Hide the ticket from boards, billing, and PDFs. A manager can restore it later."
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

      {/* Manager below-floor price approval. Opened by requestWithMarginOverride
          when a manager's save is rejected at the 15% margin floor; resolving
          retries the save with the override flag + reason. */}
      <MarginOverrideModal
        key={marginPrompt ? 'margin-prompt-open' : 'margin-prompt-closed'}
        violations={marginPrompt?.violations ?? null}
        onSubmit={(note) => {
          marginPrompt?.resolve(note)
          setMarginPrompt(null)
        }}
        onCancel={() => {
          marginPrompt?.resolve(null)
          setMarginPrompt(null)
        }}
      />

      {/* Mobile sticky action bar — the primary action stays reachable at the
          bottom of the screen on phones (≤640px) per the mobile-first-for-techs
          rule. in_progress opens the inline completion form (the full work-order
          form, which is mobile-first); a separate sticky bar below keeps "Mark
          Complete" reachable once that form is open. */}
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
              onClick={() => setShowCompletionForm(true)}
              className="w-full px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[48px]"
            >
              Complete Job
            </button>
          )}
        </div>
      )}
      {/* Sticky "Mark Complete" bar — keeps submit reachable on a phone while
          the full completion form is open. Submits the form by id so it works
          even though the button sits outside the <form>. */}
      {showMobileCompletionBar && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="submit"
            form="service-completion-form"
            disabled={loading || uploading || saving}
            className="w-full px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[48px]"
          >
            {loading ? 'Completing...' : 'Mark Complete'}
          </button>
        </div>
      )}
      <CompletionSuccessDialog
        open={completed}
        ticketsHref="/service"
        ticketsLabel="Back to Service Tickets"
        onViewWorkOrder={() => setCompleted(false)}
      />
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
    </div>
  )
}

// ── Sub-components ──
// SynergyNumberField moved to ./detail-ui (used here and in PartsSection).
