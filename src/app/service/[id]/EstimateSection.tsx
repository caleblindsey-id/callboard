'use client'

import PartsEntryList, { PartEntry } from '@/components/service/PartsEntryList'
import VerifyEquipmentPanel from '@/components/VerifyEquipmentPanel'
import { partLabel } from '@/lib/parts'
import { getPublicAppUrl } from '@/lib/urls'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import { CardSection, InfoField } from './detail-ui'
import type { ServiceTicketDetail as ServiceTicketDetailType } from '@/types/service-tickets'

interface EstimateSectionProps {
  ticket: ServiceTicketDetailType
  isManager: boolean
  isStaff: boolean
  isTech: boolean
  loading: boolean
  saving: boolean
  saveSuccess: boolean
  canEmailEstimate: boolean
  taxRatePercent: number
  laborRates: Record<string, number>
  tripChargeRate: number
  estimateOpen: boolean
  savedEstTax: number
  // Verify-first equipment gate (shared with the builder + completion form)
  showEstimateCardVerify: boolean
  equipmentToVerify: ServiceTicketDetailType['equipment'] | null
  onEquipmentVerified: () => void
  // Builder form state — owned by the parent (auto-save and submit read it)
  showEstimateForm: boolean
  setShowEstimateForm: (open: boolean) => void
  estimateRateType: string
  setEstimateRateType: (v: string) => void
  estimateLaborHours: string
  setEstimateLaborHours: (v: string) => void
  tripChargeQty: string
  setTripChargeQty: (v: string) => void
  estimateParts: PartEntry[]
  setEstimateParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  machineComplete: boolean
  onRequestEstimatePart: (index: number) => Promise<void>
  diagnosisNotes: string
  setDiagnosisNotes: (v: string) => void
  // Derived estimate math — computed in the parent alongside the saved values
  effectiveEstRate: number
  estLaborTotal: number
  estPartsTotal: number
  estTotal: number
  estTaxAmount: number
  tripChargeNum: number
  tripChargeQtyNum: number
  // Customer follow-up (estimated state, staff)
  estimateCallOpen: boolean
  setEstimateCallOpen: (open: boolean) => void
  estimateCallNotes: string
  setEstimateCallNotes: (v: string) => void
  // Actions — all mutate shared ticket state, so they live in the parent
  onSubmitEstimate: (e: React.FormEvent) => void
  onDownloadEstimate: () => void
  onEmailEstimate: () => void
  onReopenEstimate: () => void
  onLogEstimateCall: () => void
  onSaveDraft: () => void
  onSuccessMsg: (msg: string) => void
}

/**
 * Section 4: Diagnosis & Estimate — saved-estimate breakdown, approval link +
 * customer follow-up, declined summary, and the estimate builder form.
 * Extracted verbatim from ServiceTicketDetail (audit P3 refactor, round 2).
 * All state stays in the parent; this is a controlled component.
 */
export default function EstimateSection({
  ticket,
  isManager,
  isStaff,
  isTech,
  loading,
  saving,
  saveSuccess,
  canEmailEstimate,
  taxRatePercent,
  laborRates,
  tripChargeRate,
  estimateOpen,
  savedEstTax,
  showEstimateCardVerify,
  equipmentToVerify,
  onEquipmentVerified,
  showEstimateForm,
  setShowEstimateForm,
  estimateRateType,
  setEstimateRateType,
  estimateLaborHours,
  setEstimateLaborHours,
  tripChargeQty,
  setTripChargeQty,
  estimateParts,
  setEstimateParts,
  machineComplete,
  onRequestEstimatePart,
  diagnosisNotes,
  setDiagnosisNotes,
  effectiveEstRate,
  estLaborTotal,
  estPartsTotal,
  estTotal,
  estTaxAmount,
  tripChargeNum,
  tripChargeQtyNum,
  estimateCallOpen,
  setEstimateCallOpen,
  estimateCallNotes,
  setEstimateCallNotes,
  onSubmitEstimate,
  onDownloadEstimate,
  onEmailEstimate,
  onReopenEstimate,
  onLogEstimateCall,
  onSaveDraft,
  onSuccessMsg,
}: EstimateSectionProps) {
  return (
    <CardSection
      title="Diagnosis & Estimate"
      open={estimateOpen}
      summarySuffix={ticket.estimate_amount != null ? (
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          ${ticket.estimate_amount.toFixed(2)}
        </span>
      ) : undefined}
    >
      {/* Verify-first gap fill: a linked unit that still needs verification
          has no panel in the estimated/approved/declined window, yet the
          part-request gate banner points here. Render the same panel the
          estimate builder / completion form use; verifying refreshes the
          ticket and clears the gate. */}
      {showEstimateCardVerify && (
        <div className="mb-4">
          <VerifyEquipmentPanel
            equipmentId={equipmentToVerify!.id}
            make={equipmentToVerify!.make}
            model={equipmentToVerify!.model}
            serial={equipmentToVerify!.serial_number}
            onVerified={onEquipmentVerified}
            relinkTicketId={ticket.id}
            relinkTicketKind="service"
          />
        </div>
      )}

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
            {savedEstTax > 0 && (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>Sales Tax ({taxRatePercent}%)</span>
                  <span>${savedEstTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Customer total with tax</span>
                  <span>${(ticket.estimate_amount + savedEstTax).toFixed(2)}</span>
                </div>
              </div>
            )}
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
              onClick={onDownloadEstimate}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              Download Estimate PDF
            </button>
            {canEmailEstimate && (
              <button
                onClick={onEmailEstimate}
                disabled={loading}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Email Estimate
              </button>
            )}
            {/* Reopen Estimate — managers/super admins only. Pulls the
                estimate back to an editable draft (numbers preserved) from
                awaiting-approval, approved, or declined so it can be revised
                and re-sent. */}
            {isManager &&
              (ticket.status === SERVICE_STATUS.ESTIMATED ||
                ticket.status === SERVICE_STATUS.APPROVED ||
                ticket.status === SERVICE_STATUS.DECLINED) && (
              <button
                onClick={onReopenEstimate}
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
                        onSuccessMsg('Approval link copied to clipboard')
                      }}
                      className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 transition-colors shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onEmailEstimate}
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
                    onClick={onEmailEstimate}
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
                      onClick={onLogEstimateCall}
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
      {(ticket.status === SERVICE_STATUS.OPEN ||
        (ticket.status === SERVICE_STATUS.IN_PROGRESS && ticket.estimate_bypassed)) &&
        showEstimateForm && (
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
              onVerified={onEquipmentVerified}
              relinkTicketId={ticket.id}
              relinkTicketKind="service"
            />
          ) : (
          <form onSubmit={onSubmitEstimate} className="space-y-4">
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
                onRequestPart={machineComplete ? onRequestEstimatePart : undefined}
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
                {estTaxAmount > 0 && (
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Sales Tax ({taxRatePercent}%)</span>
                      <span>${estTaxAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Customer total with tax</span>
                      <span>${(estTotal + estTaxAmount).toFixed(2)}</span>
                    </div>
                  </div>
                )}
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

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={loading || saving}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-yellow-600 rounded-md hover:bg-yellow-700 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  {loading ? 'Submitting...' : 'Submit Estimate'}
                </button>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={loading || saving}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEstimateForm(false)}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                {saveSuccess && !saving && (
                  <span className="text-sm text-green-600">Saved</span>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </CardSection>
  )
}
