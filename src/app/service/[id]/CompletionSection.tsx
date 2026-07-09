'use client'

import PartsEntryList, { PartEntry } from '@/components/service/PartsEntryList'
import SignaturePad from '@/components/SignaturePad'
import VerifyEquipmentPanel from '@/components/VerifyEquipmentPanel'
import ServicePhotosSection, { PhotoWithPreview } from './ServicePhotosSection'
import { CardSection, billingTypeLabels } from './detail-ui'
import type {
  ServiceTicketDetail as ServiceTicketDetailType,
  ServiceBillingType,
} from '@/types/service-tickets'

interface CompletionSectionProps {
  ticket: ServiceTicketDetailType
  isStaff: boolean
  isTech: boolean
  loading: boolean
  saving: boolean
  saveSuccess: boolean
  // "Saved on this device" — the local draft's debounced write landed, but the
  // server round-trip hasn't (or the draft has fields the server autosave
  // doesn't cover, e.g. machine hours / date code). saveSuccess takes
  // precedence when both are true.
  localSavedVisible: boolean
  taxRatePercent: number
  laborRate: number
  tripChargeRate: number
  completionOpen: boolean
  // Verify-first equipment gate (same panel as the estimate builder)
  equipmentToVerify: ServiceTicketDetailType['equipment'] | null
  onEquipmentVerified: () => void
  // Completion form state — owned by the parent (auto-save + submit read it)
  billingType: ServiceBillingType
  setBillingType: (v: ServiceBillingType) => void
  hoursWorked: string
  setHoursWorked: (v: string) => void
  tripChargeQty: string
  setTripChargeQty: (v: string) => void
  machineHours: string
  setMachineHours: (v: string) => void
  dateCode: string
  setDateCode: (v: string) => void
  completionParts: PartEntry[]
  setCompletionParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  copyableRequestedPartsCount: number
  completionNotes: string
  setCompletionNotes: (v: string) => void
  // ACE labor (tech payout)
  aceLaborOpen: boolean
  setAceLaborOpen: (open: boolean) => void
  aceHours: string
  setAceHours: (v: string) => void
  aceReason: string
  setAceReason: (v: string) => void
  // Signature (outside/field tickets only)
  setSignatureImage: (image: string | null) => void
  setSignatureName: (name: string) => void
  // Photos — passed through to ServicePhotosSection
  photos: PhotoWithPreview[]
  setPhotos: React.Dispatch<React.SetStateAction<PhotoWithPreview[]>>
  uploading: boolean
  setUploading: (uploading: boolean) => void
  onError: (msg: string | null) => void
  // Derived billing math — computed in the parent
  laborTotal: number
  partsTotal: number
  billingTotal: number
  billTaxAmount: number
  tripChargeNum: number
  tripChargeQtyNum: number
  // Actions
  onComplete: (e: React.FormEvent) => void
  onCopyRequestedParts: () => void
}

/**
 * Section 7: Complete Job — the in-progress completion form (billing type
 * confirmation, hours, trip charge, machine hours/date code, parts used,
 * billing summary, photos, notes, ACE labor, signature, submit). Extracted
 * verbatim from ServiceTicketDetail (audit P3 refactor, round 4). All state
 * stays in the parent; this is a controlled component. The mobile sticky
 * "Mark Complete" bar submits this form by id from outside it.
 */
export default function CompletionSection({
  ticket,
  isStaff,
  isTech,
  loading,
  saving,
  saveSuccess,
  localSavedVisible,
  taxRatePercent,
  laborRate,
  tripChargeRate,
  completionOpen,
  equipmentToVerify,
  onEquipmentVerified,
  billingType,
  setBillingType,
  hoursWorked,
  setHoursWorked,
  tripChargeQty,
  setTripChargeQty,
  machineHours,
  setMachineHours,
  dateCode,
  setDateCode,
  completionParts,
  setCompletionParts,
  copyableRequestedPartsCount,
  completionNotes,
  setCompletionNotes,
  aceLaborOpen,
  setAceLaborOpen,
  aceHours,
  setAceHours,
  aceReason,
  setAceReason,
  setSignatureImage,
  setSignatureName,
  photos,
  setPhotos,
  uploading,
  setUploading,
  onError,
  laborTotal,
  partsTotal,
  billingTotal,
  billTaxAmount,
  tripChargeNum,
  tripChargeQtyNum,
  onComplete,
  onCopyRequestedParts,
}: CompletionSectionProps) {
  return (
    <CardSection title="Complete Job" open={completionOpen}>
      {equipmentToVerify ? (
        <VerifyEquipmentPanel
          equipmentId={equipmentToVerify.id}
          make={equipmentToVerify.make}
          model={equipmentToVerify.model}
          serial={equipmentToVerify.serial_number}
          onVerified={onEquipmentVerified}
          relinkTicketId={ticket.id}
          relinkTicketKind="service"
        />
      ) : (
      <form id="service-completion-form" onSubmit={onComplete} className="space-y-5 max-w-xl">
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
              step="0.5"
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
            has an hour meter). Collapsed when empty so the core fields show
            first on a phone; matches the Parts/Photos collapse pattern. */}
        <details open={machineHours !== '' || dateCode !== ''} className="rounded-md border border-gray-200 dark:border-gray-700">
          <summary className="px-3 py-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 marker:content-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
            <span>Machine Hours &amp; Date Code <span className="text-gray-400 font-normal">(optional)</span></span>
            <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="p-3 pt-0">
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
          </div>
        </details>

        {/* Parts Used — collapsible sub-section so the tech can skip
            past it on mobile when nothing's been added. Opens automatically
            when there's something to copy so the button isn't missed. */}
        <details open={completionParts.length > 0 || copyableRequestedPartsCount > 0} className="rounded-md border border-gray-200 dark:border-gray-700">
          <summary className="px-3 py-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 marker:content-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
            <span>Parts Used{completionParts.length > 0 ? ` (${completionParts.length})` : ''}</span>
            <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="p-3 pt-0">
            {copyableRequestedPartsCount > 0 && (
              <button
                type="button"
                onClick={onCopyRequestedParts}
                className="mb-3 w-full sm:w-auto px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 min-h-[44px] sm:min-h-0 transition-colors"
              >
                Copy Requested Parts ({copyableRequestedPartsCount})
              </button>
            )}
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
          {billTaxAmount > 0 && (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <div className="flex justify-between">
                <span>Sales Tax ({taxRatePercent}%)</span>
                <span>${billTaxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Customer total with tax</span>
                <span>${(billingTotal + billTaxAmount).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Photos — collapsible sub-section (extracted, audit P3 round 1). */}
        <ServicePhotosSection
          ticketId={ticket.id}
          photos={photos}
          onPhotosChange={setPhotos}
          uploading={uploading}
          onUploadingChange={setUploading}
          onError={onError}
        />

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
            className="hidden sm:block px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Completing...' : 'Mark Complete'}
          </button>
          {saving && (
            <span className="text-sm text-gray-500 dark:text-gray-400">Saving...</span>
          )}
          {saveSuccess && !saving && (
            <span className="text-sm text-green-600">Saved</span>
          )}
          {!saving && !saveSuccess && localSavedVisible && (
            <span className="text-sm text-gray-500 dark:text-gray-400">Saved on this device</span>
          )}
        </div>
      </form>
      )}
    </CardSection>
  )
}
