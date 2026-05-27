import { createAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import CreditReviewForm from './CreditReviewForm'

export const metadata: Metadata = {
  title: 'Credit Review — Imperial Dade',
  // Defense-in-depth: don't leak the single-use token via Referer.
  other: { referrer: 'no-referrer' },
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function CreditReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createAdminClient('SERVER_ONLY')

  const { data: review } = await supabase
    .from('credit_reviews')
    .select(`
      id, status, ticket_type, action_token_expires_at, customer_id,
      customers!inner ( name, account_number ),
      pm_tickets ( id, month, year, equipment ( make, model, serial_number ) ),
      service_tickets ( id, work_order_number, problem_description, estimate_amount, equipment_make, equipment_model )
    `)
    .eq('action_token', token)
    .maybeSingle()

  if (!review) {
    return (
      <ErrorPage
        title="Link Not Valid"
        message="This link is no longer valid. Please contact Imperial Dade for assistance."
      />
    )
  }

  if (review.action_token_expires_at && new Date(review.action_token_expires_at) < new Date()) {
    // Same neutral copy as not-found so the page can't be used to distinguish a
    // never-valid token from an expired one (matches the API route).
    return (
      <ErrorPage
        title="Link Not Valid"
        message="This link is no longer valid. Please contact Imperial Dade for assistance."
      />
    )
  }

  if (review.status !== 'pending') {
    return (
      <ErrorPage
        title="Already Responded"
        message="This order has already been responded to. No further action is needed."
      />
    )
  }

  const customer = first(review.customers as { name: string; account_number: string | null } | { name: string; account_number: string | null }[])
  const customerName = customer?.name ?? 'Customer'
  const accountNumber = customer?.account_number ?? null

  // Build a display label + amount for this order.
  let orderTitle = 'Order'
  let orderDetail: string | null = null
  let amountLabel = 'Per contract — no charge'

  if (review.ticket_type === 'pm') {
    const pm = first(review.pm_tickets as
      | { month: number; year: number; equipment: unknown }
      | { month: number; year: number; equipment: unknown }[])
    const equip = first(pm?.equipment as { make: string | null; model: string | null; serial_number: string | null } | null)
    const monthLabel = pm ? `${MONTHS[(pm.month - 1) % 12] ?? ''} ${pm.year}`.trim() : ''
    orderTitle = `Preventive Maintenance${monthLabel ? ` — ${monthLabel}` : ''}`
    orderDetail = equip
      ? [[equip.make, equip.model].filter(Boolean).join(' '), equip.serial_number ? `S/N ${equip.serial_number}` : null]
          .filter(Boolean)
          .join(' · ') || null
      : null
  } else {
    const svc = first(review.service_tickets as
      | { work_order_number: number | null; problem_description: string | null; estimate_amount: number | null; equipment_make: string | null; equipment_model: string | null }
      | { work_order_number: number | null; problem_description: string | null; estimate_amount: number | null; equipment_make: string | null; equipment_model: string | null }[])
    orderTitle = svc?.work_order_number ? `Service — WO-${svc.work_order_number}` : 'Service Order'
    orderDetail =
      svc?.problem_description ??
      ([svc?.equipment_make, svc?.equipment_model].filter(Boolean).join(' ') || null)
    amountLabel = svc?.estimate_amount != null ? `$${svc.estimate_amount.toFixed(2)}` : 'To be determined'
  }

  // How many other orders for this customer are still awaiting a decision. We
  // show only a count — never the sibling tokens, which are live secrets (a
  // forwarded link must not expose the customer's whole pending set). AR already
  // received a per-order link for each in the original email.
  const { count: otherPending } = await supabase
    .from('credit_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', review.customer_id)
    .eq('status', 'pending')
    .neq('id', review.id)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/imperial-dade-logo.png" alt="Imperial Dade" className="h-12 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Credit Approval Request</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {customerName}
            {accountNumber ? ` — Acct ${accountNumber}` : ''}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-red-50 dark:bg-red-900/20">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              This customer is on credit hold.
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
              Decide whether the following work should proceed or be blocked.
            </p>
          </div>
          <div className="px-6 py-5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{orderTitle}</h2>
            {orderDetail && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{orderDetail}</p>
            )}
            <div className="flex justify-between items-center pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Estimated amount</span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">{amountLabel}</span>
            </div>
          </div>
        </div>

        <CreditReviewForm token={token} />

        {otherPending != null && otherPending > 0 && (
          <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              This customer has <strong>{otherPending}</strong> other order{otherPending === 1 ? '' : 's'} awaiting
              a credit decision. Each has its own link in the email we sent.
            </p>
          </div>
        )}
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
