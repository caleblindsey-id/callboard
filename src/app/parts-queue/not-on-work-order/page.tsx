import Link from 'next/link'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPartsMissingFromWorkOrder } from '@/lib/db/parts-queue'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

/**
 * Office reconciliation: fulfilled parts that never reached the work order.
 *
 * parts_requested is procurement; parts_used / additional_parts_used are the
 * billable work order, and only the latter reaches billing, the work-order PDF,
 * and the billing export. Parts are now auto-added the moment they are received
 * or pulled, but a tech can still delete a line, parts fulfilled before that
 * shipped were never linked, and a completion form left open can overwrite the
 * array. This page is the standing check that the loop is closed.
 *
 * Scope is deliberately everything still fixable: open tickets plus completed-
 * but-not-yet-billed. Once a ticket is billed the money has left the building
 * and it is a credit-memo conversation, not a queue item.
 *
 * Lives on its own page rather than as a sixth /parts-queue tab because the tab
 * machinery there is built entirely around the parts_order_queue view row, and
 * this list has to carry work-order line state the view does not have.
 */
export default async function PartsNotOnWorkOrderPage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPartsMissingFromWorkOrder()

  const totalValue = rows.reduce((sum, r) => sum + r.extended_value, 0)
  const ticketCount = new Set(rows.map((r) => r.ticket_id)).size

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Parts Not on a Work Order"
        subtitle="Received or pulled from stock, but missing from the ticket's billable lines — the customer was not charged."
        backHref="/parts-queue"
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-6 text-center">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            Every fulfilled part is on its work order.
          </p>
          <p className="mt-1 text-xs text-green-700 dark:text-green-400">
            Billed tickets are out of scope here — those are a credit-memo conversation.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Parts missing
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {rows.length}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Tickets affected
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {ticketCount}
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Unbilled value
              </div>
              <div className="mt-1 text-2xl font-semibold text-amber-900 dark:text-amber-200">
                ${totalValue.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <Th>WO #</Th>
                  <Th>Type</Th>
                  <Th>Customer</Th>
                  <Th>Tech</Th>
                  <Th>Item #</Th>
                  <Th>Part</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Value</Th>
                  <Th>Fulfilled</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {rows.map((r) => (
                  <tr
                    key={`${r.source}-${r.ticket_id}-${r.part_index}`}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={r.source === 'pm' ? `/tickets/${r.ticket_id}` : `/service/${r.ticket_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {r.work_order_number ?? '—'}
                      </Link>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{r.ticket_status}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-xs uppercase text-gray-600 dark:text-gray-400">
                        {r.source}
                      </span>
                      {r.source === 'pm' && r.covered_by_agreement === true && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">covered</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{r.customer_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {r.assigned_technician_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {r.product_number ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">
                      {r.description ?? '—'}
                      {r.detail && (
                        <span className="text-gray-500 dark:text-gray-400"> — {r.detail}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{r.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">
                      ${r.extended_value.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                      {r.status === 'from_stock' ? 'Pulled from stock' : 'Received'}
                      {(r.received_at ?? r.pulled_at) && (
                        <div>{new Date((r.received_at ?? r.pulled_at)!).toLocaleDateString()}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            A part shows here until it appears on the ticket&apos;s parts used, or a tech marks it
            &quot;not used&quot; with a reason. Where a part has no Synergy item # the match falls back
            to the description, which cuts both ways: it can miss a real gap when the same part was
            billed under very different wording, and it can list a part that was in fact billed that
            way. Open the ticket to check before chasing one.
          </p>
        </>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 ${className}`.trim()}
    >
      {children}
    </th>
  )
}
