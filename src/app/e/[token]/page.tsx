import { createAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import ApprovalForm from './ApprovalForm'

export const metadata: Metadata = {
  title: 'Service Estimate — Imperial Dade',
  // Defense-in-depth against future analytics/CDN scripts leaking the
  // single-use approval token via Referer header.
  other: { referrer: 'no-referrer' },
}

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: ticket } = await supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, status, problem_description, diagnosis_notes,
      estimate_labor_hours, estimate_labor_rate, estimate_parts, estimate_amount,
      billing_type,
      service_address, service_city, service_state, service_zip,
      equipment_make, equipment_model, equipment_serial_number,
      approval_token_expires_at, created_at,
      customers!inner ( name, account_number ),
      equipment ( make, model, serial_number, description )
    `)
    .eq('approval_token', token)
    .single()

  if (!ticket) {
    return (
      <ErrorPage
        title="Link Not Valid"
        message="This link is no longer valid. Please contact Imperial Dade for assistance."
      />
    )
  }

  if (ticket.approval_token_expires_at && new Date(ticket.approval_token_expires_at) < new Date()) {
    return (
      <ErrorPage
        title="Link Expired"
        message="This link has expired. Please contact Imperial Dade for a new estimate link."
      />
    )
  }

  if (ticket.status !== 'estimated') {
    return (
      <ErrorPage
        title="Already Responded"
        message="This estimate has already been responded to. No further action is needed."
      />
    )
  }

  const laborHours = ticket.estimate_labor_hours ?? 0
  const laborRate = ticket.estimate_labor_rate ?? 0
  const laborTotal = laborHours * laborRate
  const parts = (ticket.estimate_parts ?? []) as Array<{
    description: string
    quantity: number
    unit_price: number
    warranty_covered?: boolean
  }>
  const isWarranty = ticket.billing_type === 'warranty'
  const partsTotal = isWarranty
    ? 0
    : parts
        .filter(p => !p.warranty_covered)
        .reduce((sum, p) => sum + p.quantity * p.unit_price, 0)
  const total = laborTotal + partsTotal

  const equipmentRow = Array.isArray(ticket.equipment) ? ticket.equipment[0] : ticket.equipment
  const equipmentLabel = equipmentRow
    ? [(equipmentRow as { make?: string; model?: string }).make, (equipmentRow as { make?: string; model?: string }).model].filter(Boolean).join(' ')
    : [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') || null

  const serviceAddress = [
    ticket.service_address,
    ticket.service_city,
    ticket.service_state,
    ticket.service_zip,
  ].filter(Boolean).join(', ')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/imperial-dade-logo.png"
            alt="Imperial Dade"
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Service Estimate</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {ticket.work_order_number ? `WO-${ticket.work_order_number}` : 'Service Estimate'}
            {' — '}
            {new Date(ticket.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Customer & Equipment
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Customer</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {(Array.isArray(ticket.customers) ? (ticket.customers as { name: string }[])[0] : ticket.customers as { name: string })?.name ?? 'Unknown'}
                </p>
              </div>
              {equipmentLabel && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Equipment</span>
                  <p className="font-medium text-gray-900 dark:text-white">{equipmentLabel}</p>
                </div>
              )}
              {ticket.equipment_serial_number && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Serial Number</span>
                  <p className="font-medium text-gray-900 dark:text-white">{ticket.equipment_serial_number}</p>
                </div>
              )}
              {serviceAddress && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Service Address</span>
                  <p className="font-medium text-gray-900 dark:text-white">{serviceAddress}</p>
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              Problem Description
            </h2>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {ticket.problem_description}
            </p>
            {ticket.diagnosis_notes && (
              <>
                <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-4 mb-2">
                  Diagnosis
                </h2>
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {ticket.diagnosis_notes}
                </p>
              </>
            )}
          </div>

          <div className="px-6 py-4">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Estimate
            </h2>
            <div className="space-y-2 text-sm">
              {laborHours > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">
                    Labor: {laborHours} hrs × ${laborRate.toFixed(2)}/hr
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">${laborTotal.toFixed(2)}</span>
                </div>
              )}
              {parts.map((part, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">
                    {part.description} ×{part.quantity}
                    {part.warranty_covered ? ' (warranty)' : ''}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {part.warranty_covered ? '$0.00' : `$${(part.quantity * part.unit_price).toFixed(2)}`}
                  </span>
                </div>
              ))}
              <div className="flex justify-between pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-base font-bold text-gray-900 dark:text-white">Estimate Total</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">${total.toFixed(2)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              This estimate is subject to change. All prices are subject to applicable taxes.
            </p>
          </div>
        </div>

        <ApprovalForm token={token} />
      </div>
    </div>
  )
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/imperial-dade-logo.png"
          alt="Imperial Dade"
          className="h-10 mx-auto mb-6"
        />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
      </div>
    </div>
  )
}
