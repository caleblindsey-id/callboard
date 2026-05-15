'use client'

import { TicketWithJoins } from '@/lib/db/tickets'
import type { PartUsed } from '@/types/database'

interface BillingPreviewModalProps {
  open: boolean
  tickets: TicketWithJoins[]
  exporting: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Returns true if the ticket has any pricing concerns the user should
 * eyeball before exporting:
 *   - billing_amount is null or 0 (no labor line will print)
 *   - any used-part is missing a Synergy product match (client-side null check
 *     only; the server-side resolver still runs at PDF time — this is a soft
 *     visual flag, not a hard gate).
 */
function ticketIsFlagged(t: TicketWithJoins): { flagged: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (t.billing_amount == null || t.billing_amount === 0) {
    reasons.push('no billing amount')
  }
  const partsUsed = (t.parts_used ?? []) as PartUsed[]
  const additional = (t.additional_parts_used ?? []) as PartUsed[]
  const unmatched = [...partsUsed, ...additional].filter(
    (p) => p.synergy_product_id == null
  )
  if (unmatched.length > 0) {
    reasons.push(`${unmatched.length} unmatched part${unmatched.length === 1 ? '' : 's'}`)
  }
  return { flagged: reasons.length > 0, reasons }
}

function partsTotal(t: TicketWithJoins): number {
  const used = (t.parts_used ?? []) as PartUsed[]
  const additional = (t.additional_parts_used ?? []) as PartUsed[]
  return [...used, ...additional].reduce(
    (sum, p) => sum + (p.quantity ?? 0) * (p.unit_price ?? 0),
    0
  )
}

export default function BillingPreviewModal({
  open,
  tickets,
  exporting,
  onCancel,
  onConfirm,
}: BillingPreviewModalProps) {
  if (!open) return null

  const total = tickets.reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)
  const flaggedCount = tickets.filter((t) => ticketIsFlagged(t).flagged).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Export Preview
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Review the tickets below before generating the PDF. Nothing is marked as
            billed until you click <span className="font-medium">Export PDF</span>.
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto">
          {tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No tickets selected.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Completed</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-400">Hours</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-400">Parts</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-400">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {tickets.map((t) => {
                  const flag = ticketIsFlagged(t)
                  const rowClass = flag.flagged
                    ? 'bg-amber-50 dark:bg-amber-900/20'
                    : ''
                  return (
                    <tr key={t.id} className={rowClass}>
                      <td className="px-4 py-2 text-gray-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span>{t.customers?.name ?? '—'}</span>
                          {flag.flagged && (
                            <span
                              title={flag.reasons.join(', ')}
                              className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-700/50 text-amber-900 dark:text-amber-200"
                            >
                              flagged
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                        {[t.equipment?.make, t.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                        {t.completed_date
                          ? new Date(t.completed_date).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                        {t.hours_worked ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                        ${partsTotal(t).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900 dark:text-white font-medium">
                        {t.billing_amount != null
                          ? `$${t.billing_amount.toFixed(2)}`
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">{tickets.length}</span> ticket
            {tickets.length === 1 ? '' : 's'} —{' '}
            <span className="font-medium">${total.toFixed(2)}</span>
            {flaggedCount > 0 && (
              <span className="ml-2 text-amber-700 dark:text-amber-400">
                · {flaggedCount} flagged
              </span>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button
              onClick={onCancel}
              disabled={exporting}
              className="px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-gray-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={tickets.length === 0 || exporting}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              {exporting ? 'Generating PDF...' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
