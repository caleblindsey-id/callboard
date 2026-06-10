'use client'

interface TripChargeCardProps {
  amount: string
  setAmount: (v: string) => void
  onSave: () => void
  loading: boolean
  isBench: boolean
}

/**
 * Staff-only trip-charge capture — a flat fee for sending a tech out, billed
 * alongside labor. Lives in its own card next to the Diagnostic Fee. State is
 * held by the parent so this stays a controlled, focus-stable component. The
 * amount is seeded from the Settings default (0 for bench/shop drop-offs) and
 * can be edited or zeroed per ticket; the saved value rolls into billing_amount.
 */
export default function TripChargeCard({
  amount,
  setAmount,
  onSave,
  loading,
  isBench,
}: TripChargeCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Trip Charge
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {isBench
            ? 'Shop / bench drop-off — defaults to $0 (no travel). Override if needed.'
            : 'Flat fee for the trip out. Defaults from Settings; edit or zero per ticket.'}
        </p>
      </div>
      <div className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
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
      </div>
    </div>
  )
}
