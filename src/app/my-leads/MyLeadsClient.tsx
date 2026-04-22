'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { TechLeadStatus } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import SubmitLeadModal from './SubmitLeadModal'

interface Props {
  leads: TechLeadWithJoins[]
}

const STATUS_LABEL: Record<TechLeadStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved — waiting on first PM',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  earned: 'Earned',
  paid: 'Paid',
}

const STATUS_STYLE: Record<TechLeadStatus, string> = {
  pending:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  approved:  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  rejected:  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  earned:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  paid:      'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(amount: number | null): string {
  if (amount == null) return '—'
  return `$${amount.toFixed(2)}`
}

export default function MyLeadsClient({ leads }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
        </p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-md"
        >
          <Plus className="h-4 w-4" />
          Submit lead
        </button>
      </div>

      {leads.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            You haven&apos;t submitted any leads yet. Tap <strong>Submit lead</strong> to file one.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {leads.map(lead => {
            const customer = lead.customers?.name || lead.customer_name_text || '—'
            const subLine = [lead.equipment_description, lead.proposed_pm_frequency]
              .filter(Boolean)
              .join(' · ')
            return (
              <li
                key={lead.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{customer}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Submitted {formatDate(lead.submitted_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-md text-xs font-medium ${STATUS_STYLE[lead.status]}`}>
                    {STATUS_LABEL[lead.status]}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                  {subLine}
                </p>
                {lead.notes && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic whitespace-pre-wrap break-words">
                    {lead.notes}
                  </p>
                )}
                {lead.status === 'rejected' && lead.rejected_reason && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                    <strong>Rejection reason:</strong> {lead.rejected_reason}
                  </p>
                )}
                {lead.status === 'cancelled' && lead.cancelled_reason && (
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    <strong>Cancelled:</strong> {lead.cancelled_reason}
                  </p>
                )}
                {(lead.status === 'earned' || lead.status === 'paid') && (
                  <div className="mt-3 flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <span>Bonus: <strong>{formatMoney(lead.bonus_amount)}</strong></span>
                    {lead.earned_at && <span>Earned {formatDate(lead.earned_at)}</span>}
                    {lead.paid_at && <span>Paid {formatDate(lead.paid_at)}</span>}
                    {lead.payout_period && <span>Period {lead.payout_period}</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <SubmitLeadModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
