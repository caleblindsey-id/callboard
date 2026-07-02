'use client'

interface DiagnosticFeeCardProps {
  invoiceNumber: string
  setInvoiceNumber: (v: string) => void
  amount: string
  setAmount: (v: string) => void
  onSave: () => void
  loading: boolean
  currentCharge: number | null
  currentInvoiceNumber: string | null
  // Nightly Synergy verification of the invoice # (migration 137). Gates the
  // credit on the customer-facing estimate, so surface it to the office here.
  validationStatus: 'valid' | 'invalid' | null
}

/**
 * Staff-only diagnostic-fee capture. Lives in its own card (rather than wedged
 * inside the Diagnosis & Estimate widget) because a diagnostic charge can be
 * billed separately in Synergy at any active stage of the ticket. State is held
 * by the parent so this stays a controlled, focus-stable component.
 */
export default function DiagnosticFeeCard({
  invoiceNumber,
  setInvoiceNumber,
  amount,
  setAmount,
  onSave,
  loading,
  currentCharge,
  currentInvoiceNumber,
  validationStatus,
}: DiagnosticFeeCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Diagnostic Fee
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          If billed separately in Synergy
        </p>
      </div>
      <div className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Synergy Invoice #
            </label>
            <input
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
          <button
            onClick={onSave}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Save
          </button>
        </div>
        {(currentCharge != null || currentInvoiceNumber) && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Current:
            {currentCharge != null && ` $${currentCharge.toFixed(2)}`}
            {currentInvoiceNumber && ` on invoice #${currentInvoiceNumber}`}
          </p>
        )}
        {currentInvoiceNumber && (
          validationStatus === 'valid' ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              Verified in Synergy — shows as a credit on the customer estimate.
            </p>
          ) : validationStatus === 'invalid' ? (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              Invoice # not found in Synergy — the estimate will charge the fee, not credit it. Check the number.
            </p>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Verification pending (checked nightly) — the estimate charges the fee until the invoice # is verified.
            </p>
          )
        )}
      </div>
    </div>
  )
}
