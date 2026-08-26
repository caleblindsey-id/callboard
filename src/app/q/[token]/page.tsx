import { createAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import { frequencyLabel } from '@/lib/pm-quotes/build'
import { formatMoney } from '@/lib/format'
import QuoteApprovalForm from './QuoteApprovalForm'

export const metadata: Metadata = {
  title: 'Preventative Maintenance Quote — Imperial Dade',
  // Defense in depth against a future analytics or CDN script leaking the
  // single-use token through the Referer header.
  other: { referrer: 'no-referrer' },
}

export default async function QuoteApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createAdminClient('SERVER_ONLY')

  const { data: quote } = await supabase
    .from('pm_quotes')
    .select(`
      id, quote_number, status, subtotal, notes,
      approval_token_expires_at, created_at, deleted_at,
      customers!inner ( name, account_number, ar_terms, po_required, tax_exempt ),
      pm_quote_lines ( work_order_number, equipment_label, equipment_description, serial_number, interval_months, amount, sort_order )
    `)
    .eq('approval_token', token)
    .single()

  if (!quote || quote.deleted_at) {
    return (
      <ErrorPage
        title="Link Not Valid"
        message="This link is no longer valid. Please contact Imperial Dade for assistance."
      />
    )
  }

  if (quote.approval_token_expires_at && new Date(quote.approval_token_expires_at) < new Date()) {
    return (
      <ErrorPage
        title="Link Expired"
        message="This link has expired. Please contact Imperial Dade for a new quote link."
      />
    )
  }

  if (quote.status !== 'sent') {
    return (
      <ErrorPage
        title="Already Responded"
        message="This quote has already been responded to. No further action is needed."
      />
    )
  }

  const customer = quote.customers as unknown as {
    name: string
    account_number: string | null
    ar_terms: string | null
    po_required: boolean | null
    tax_exempt: boolean | null
  }

  const lines = [...((quote.pm_quote_lines ?? []) as unknown as Array<{
    work_order_number: number | null
    equipment_label: string | null
    equipment_description: string | null
    serial_number: string | null
    interval_months: number | null
    amount: number
    sort_order: number
  }>)].sort(
    (a, b) => a.sort_order - b.sort_order || (a.work_order_number ?? 0) - (b.work_order_number ?? 0)
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/imperial-dade-logo.png" alt="Imperial Dade" className="h-10 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Preventative Maintenance Quote
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Q-{quote.quote_number} for {customer.name}
            {customer.account_number ? ` (account ${customer.account_number})` : ''}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Scheduled Maintenance
          </h2>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {lines.map((l, idx) => (
              <div key={idx} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {l.equipment_label ?? 'Equipment'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {[
                      l.work_order_number ? `WO ${l.work_order_number}` : null,
                      l.equipment_description,
                      l.serial_number ? `Serial ${l.serial_number}` : null,
                      frequencyLabel(l.interval_months),
                    ]
                      .filter(Boolean)
                      .join('  |  ')}
                  </p>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                  {formatMoney(l.amount)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-1">
            {customer.tax_exempt && (
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Sales Tax</span>
                <span>Exempt</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white">
              <span>Quote Total</span>
              <span>{formatMoney(quote.subtotal)}</span>
            </div>
            {customer.ar_terms && (
              <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
                Payment terms: {customer.ar_terms}
              </p>
            )}
          </div>

          {quote.notes && (
            <p className="mt-4 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line">
              {quote.notes}
            </p>
          )}
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-lg px-4 py-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This quote covers scheduled preventative maintenance only. If a technician finds a
            repair need during the visit, that work is quoted separately and is not performed
            without your approval. Any applicable sales tax is calculated at the time of invoicing.
          </p>
        </div>

        <QuoteApprovalForm token={token} poRequired={!!customer.po_required} />
      </div>
    </div>
  )
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/imperial-dade-logo.png" alt="Imperial Dade" className="h-10 mx-auto mb-6" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
      </div>
    </div>
  )
}
