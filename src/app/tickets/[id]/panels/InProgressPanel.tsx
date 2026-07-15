import type { ReactNode } from 'react'
import { UserRole, LaborRateType } from '@/types/database'
import VerifyEquipmentPanel from '@/components/VerifyEquipmentPanel'
import SignaturePad from '@/components/SignaturePad'
import InlineError from '@/components/ui/InlineError'
import SkipRequestForm, { SkipRequestPayload } from '../SkipRequestForm'
import { renderPartsSection } from '../renderPartsSection'
import { formatPhoneNumber } from '@/lib/phone'
import { ACTIONS } from '@/lib/labels'
import type { PartEntry } from '../TicketActions'

export interface InProgressPanelProps {
  error: string | null
  equipmentToVerify: { id: string; make: string | null; model: string | null; serial_number: string | null } | null
  ticketId: string
  onEquipmentVerified: () => void
  handleComplete: (e: React.FormEvent) => void

  completedDate: string
  setCompletedDate: (v: string) => void
  hoursWorked: string
  setHoursWorked: (v: string) => void
  machineHours: string
  setMachineHours: (v: string) => void
  dateCode: string
  setDateCode: (v: string) => void

  pmParts: PartEntry[]
  setPmParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  pmDebounceRefs: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>
  pmComboRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
  isFlatRate: boolean
  flatRate: number | null

  additionalHoursWorked: string
  setAdditionalHoursWorked: (v: string) => void
  additionalLaborTotal: number
  laborRate: number
  laborRateType: LaborRateType
  setLaborRateType: (v: LaborRateType) => void
  isTech: boolean
  tripChargeQty: string
  setTripChargeQty: (v: string) => void
  tripChargeRate: number
  tripChargeNum: number

  additionalParts: PartEntry[]
  setAdditionalParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  addlDebounceRefs: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>
  addlComboRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
  additionalPartsTotal: number
  additionalSubtotal: number

  grandTotal: number

  completionNotes: string
  setCompletionNotes: (v: string) => void

  aceLaborOpen: boolean
  setAceLaborOpen: (v: boolean) => void
  aceHours: string
  setAceHours: (v: string) => void
  aceReason: string
  setAceReason: (v: string) => void

  billingContactName: string
  setBillingContactName: (v: string) => void
  billingContactEmail: string
  setBillingContactEmail: (v: string) => void
  billingContactPhone: string
  setBillingContactPhone: (v: string) => void

  photos: Array<{ storage_path: string; uploaded_at: string; previewUrl?: string }>
  onPhotoDelete: (index: number) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onPhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  uploading: boolean

  onSignatureChange: (data: { image: string | null; name: string }) => void

  onSaveProgress: () => void
  saving: boolean
  loading: boolean

  skipRequestOpen: boolean
  onOpenSkipRequest: () => void
  onCancelSkipRequest: () => void
  skipDefaultMonth: number
  skipDefaultYear: number
  onSubmitSkipRequest: (payload: SkipRequestPayload) => void

  saveSuccess: boolean
  localSavedVisible: boolean

  userRole: UserRole | null
  onConfirmReopen: (opts: { title: string; message: string; confirmLabel: string; targetStatus: string }) => void

  superAdminOverride: ReactNode
  deleteButton: ReactNode
  confirmActionDialog: ReactNode
}

/**
 * Completion form for a PM ticket that's 'in_progress': the tech's Complete
 * PM Ticket workflow (parts, labor, ACE labor, billing contact, photos,
 * signature) plus the manager-only Reopen controls. Mechanical extraction
 * from TicketActions.tsx (round 12 stage A); no logic changed, only moved
 * (the auto-save/dirty-diff state and every handler still live in the
 * TicketActions coordinator).
 */
export default function InProgressPanel({
  error,
  equipmentToVerify,
  ticketId,
  onEquipmentVerified,
  handleComplete,
  completedDate,
  setCompletedDate,
  hoursWorked,
  setHoursWorked,
  machineHours,
  setMachineHours,
  dateCode,
  setDateCode,
  pmParts,
  setPmParts,
  pmDebounceRefs,
  pmComboRefs,
  isFlatRate,
  flatRate,
  additionalHoursWorked,
  setAdditionalHoursWorked,
  additionalLaborTotal,
  laborRate,
  laborRateType,
  setLaborRateType,
  isTech,
  tripChargeQty,
  setTripChargeQty,
  tripChargeRate,
  tripChargeNum,
  additionalParts,
  setAdditionalParts,
  addlDebounceRefs,
  addlComboRefs,
  additionalPartsTotal,
  additionalSubtotal,
  grandTotal,
  completionNotes,
  setCompletionNotes,
  aceLaborOpen,
  setAceLaborOpen,
  aceHours,
  setAceHours,
  aceReason,
  setAceReason,
  billingContactName,
  setBillingContactName,
  billingContactEmail,
  setBillingContactEmail,
  billingContactPhone,
  setBillingContactPhone,
  photos,
  onPhotoDelete,
  fileInputRef,
  onPhotoUpload,
  uploading,
  onSignatureChange,
  onSaveProgress,
  saving,
  loading,
  skipRequestOpen,
  onOpenSkipRequest,
  onCancelSkipRequest,
  skipDefaultMonth,
  skipDefaultYear,
  onSubmitSkipRequest,
  saveSuccess,
  localSavedVisible,
  userRole,
  onConfirmReopen,
  superAdminOverride,
  deleteButton,
  confirmActionDialog,
}: InProgressPanelProps) {
  return (
    <>
      <div id="pm-completion-form" className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Complete PM Ticket
        </h2>
        {error && <InlineError message={error} className="mb-3" />}
        {equipmentToVerify ? (
          <VerifyEquipmentPanel
            equipmentId={equipmentToVerify.id}
            make={equipmentToVerify.make}
            model={equipmentToVerify.model}
            serial={equipmentToVerify.serial_number}
            onVerified={onEquipmentVerified}
            relinkTicketId={ticketId}
            relinkTicketKind="pm"
          />
        ) : (
        <form onSubmit={handleComplete} className="space-y-5 max-w-xl">
          {/* Completion date. The customer PO is entered/edited in the
              dedicated "Customer PO #" section above (single source of truth);
              a second PO input here desynced from it and could blank a saved PO
              on completion. */}
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

            {/* Labor Type — the rate this additional (non-PM) labor is billed at.
                The covered PM work is flat-rate under agreement, so this only
                drives the Additional Labor line + ACE payout (feedback #76). */}
            <div className="mb-3">
              <label htmlFor="additionalLaborRateType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Labor Type
              </label>
              <select
                id="additionalLaborRateType"
                value={laborRateType}
                onChange={(e) => setLaborRateType(e.target.value as LaborRateType)}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="standard">Standard</option>
                <option value="industrial">Industrial</option>
                <option value="vacuum">Vacuum</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Rate applied to the additional labor hours below.</p>
            </div>

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

            {/* Trip Charge — trips × per-trip rate, billed alongside labor */}
            {!isTech && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Trip Charge
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={tripChargeQty}
                    onChange={(e) => setTripChargeQty(e.target.value)}
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 w-28 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="0"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {tripChargeRate > 0
                      ? `× $${tripChargeRate.toFixed(2)}/trip = $${tripChargeNum.toFixed(2)}`
                      : 'trips — set the rate in Settings'}
                  </span>
                </div>
              </div>
            )}

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
                {isFlatRate && `PM: $${(flatRate ?? 0).toFixed(2)}`}
                {isFlatRate && additionalSubtotal > 0 && ' + '}
                {additionalSubtotal > 0 && `Additional: $${additionalSubtotal.toFixed(2)}`}
                {tripChargeNum > 0 && (isFlatRate || additionalSubtotal > 0) && ' + '}
                {tripChargeNum > 0 && `Trip: $${tripChargeNum.toFixed(2)}`}
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
                      onClick={() => onPhotoDelete(i)}
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
              onChange={onPhotoUpload}
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

          <SignaturePad onSignatureChange={onSignatureChange} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSaveProgress}
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
                onClick={onOpenSkipRequest}
                disabled={loading || saving}
                className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Request Skip
              </button>
            )}
            {saveSuccess ? (
              <span className="text-sm text-green-600">Saved</span>
            ) : localSavedVisible ? (
              <span className="text-sm text-gray-500 dark:text-gray-400">Saved on this device</span>
            ) : null}
          </div>

          {/* Skip request form — tech only, in_progress */}
          {skipRequestOpen && isTech && (
            <SkipRequestForm
              defaultMonth={skipDefaultMonth}
              defaultYear={skipDefaultYear}
              loading={loading}
              onSubmit={onSubmitSkipRequest}
              onCancel={onCancelSkipRequest}
            />
          )}
        </form>
        )}
        {(userRole === 'super_admin' || userRole === 'manager') && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Manager: Reopen ticket status</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onConfirmReopen({ title: 'Reopen to Assigned?', message: 'Reopen this ticket to Assigned? Draft work will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'assigned' })}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
              >
                Reopen to Assigned
              </button>
              <button
                type="button"
                onClick={() => onConfirmReopen({ title: 'Reopen to Unassigned?', message: 'Reopen this ticket to Unassigned? Draft work and technician assignment will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'unassigned' })}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
              >
                Reopen to Unassigned
              </button>
            </div>
          </div>
        )}
        {superAdminOverride}
      </div>
      {deleteButton}
      {confirmActionDialog}
    </>
  )
}
