'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TechLeadStatus, TechLeadType, UserRole } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import type { CandidateWithLead } from '@/lib/db/equipment-sale-candidates'
import { tierLabel } from '@/lib/tech-leads/bonus-tiers'
import LeadReviewModal from './LeadReviewModal'
import CreateEquipmentFromLeadModal from './CreateEquipmentFromLeadModal'
import PayoutReport from './PayoutReport'
import MatchCandidatesTab from './MatchCandidatesTab'

type TabKey = 'pending' | 'approved' | 'match' | 'earned' | 'paid' | 'closed' | 'payout'
type TypeFilter = 'all' | TechLeadType

interface Props {
  leads: TechLeadWithJoins[]
  candidatesByLead: Record<string, CandidateWithLead[]>
  userRole?: UserRole | null
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'match',    label: 'Match Candidates' },
  { key: 'earned',   label: 'Earned (unpaid)' },
  { key: 'paid',     label: 'Paid' },
  { key: 'closed',   label: 'Rejected / Cancelled / Expired' },
  { key: 'payout',   label: 'Payout Report' },
]

function partitionByTab(leads: TechLeadWithJoins[], tab: TabKey): TechLeadWithJoins[] {
  switch (tab) {
    case 'pending':  return leads.filter(l => l.status === 'pending')
    case 'approved': return leads.filter(l => l.status === 'approved')
    case 'match':    return leads.filter(l => l.status === 'match_pending')
    case 'earned':   return leads.filter(l => l.status === 'earned')
    case 'paid':     return leads.filter(l => l.status === 'paid')
    case 'closed':   return leads.filter(l => l.status === 'rejected' || l.status === 'cancelled' || l.status === 'expired')
    default:         return []
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function statusBadge(status: TechLeadStatus): string {
  switch (status) {
    case 'pending':       return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    case 'approved':      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
    case 'match_pending': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
    case 'rejected':      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    case 'cancelled':     return 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
    case 'expired':       return 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
    case 'earned':        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    case 'paid':          return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200'
  }
}

function leadTypePill(type: TechLeadType): string {
  return type === 'equipment_sale'
    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
}

function leadTypeLabel(type: TechLeadType): string {
  return type === 'equipment_sale' ? 'Equipment sale' : 'PM'
}

export default function TechLeadsClient({ leads, candidatesByLead }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('pending')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [reviewLead, setReviewLead] = useState<TechLeadWithJoins | null>(null)
  const [equipLead, setEquipLead] = useState<TechLeadWithJoins | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const typeFiltered = useMemo(
    () => typeFilter === 'all' ? leads : leads.filter(l => l.lead_type === typeFilter),
    [leads, typeFilter]
  )
  const filtered = useMemo(() => partitionByTab(typeFiltered, tab), [typeFiltered, tab])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pending: 0, approved: 0, match: 0, earned: 0, paid: 0, closed: 0, payout: 0 }
    for (const l of typeFiltered) {
      if (l.status === 'pending')             c.pending++
      else if (l.status === 'approved')       c.approved++
      else if (l.status === 'match_pending')  c.match++
      else if (l.status === 'earned')         c.earned++
      else if (l.status === 'paid')           c.paid++
      else                                    c.closed++
    }
    return c
  }, [typeFiltered])

  async function callUpdate(leadId: string, payload: Record<string, unknown>) {
    setBusyId(leadId)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${leadId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to update lead.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lead.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(lead: TechLeadWithJoins) {
    const reason = window.prompt('Reason for cancelling this lead? (shown to the tech)')
    if (!reason?.trim()) return
    await callUpdate(lead.id, { action: 'cancel', reason: reason.trim() })
  }

  return (
    <>
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Type filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'pm', 'equipment_sale'] as TypeFilter[]).map(f => {
          const active = typeFilter === f
          const label = f === 'all' ? 'All leads' : f === 'pm' ? 'PM leads' : 'Equipment sale leads'
          return (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {TABS.map(t => {
            const active = tab === t.key
            const count = counts[t.key]
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`pb-3 pt-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-slate-900 dark:border-slate-200 text-slate-900 dark:text-slate-100'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {t.label}
                {t.key !== 'payout' && count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'payout' ? (
        <PayoutReport leads={typeFiltered} />
      ) : tab === 'match' ? (
        <MatchCandidatesTab
          leads={filtered}
          candidatesByLead={candidatesByLead}
          onRefresh={() => router.refresh()}
        />
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No leads in this tab.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Tech</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3">Freq / Tier</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map(lead => {
                const customer = lead.customers?.name
                  ? lead.customers.name
                  : lead.customer_name_text
                    ? `${lead.customer_name_text} (new)`
                    : '—'
                const isEquipmentSale = lead.lead_type === 'equipment_sale'
                const isBusy = busyId === lead.id
                return (
                  <tr key={lead.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${leadTypePill(lead.lead_type)}`}>
                        {leadTypeLabel(lead.lead_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white whitespace-nowrap">
                      {lead.submitter?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white">
                      {customer}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-sm">
                      <p className="whitespace-pre-wrap break-words">
                        {isEquipmentSale
                          ? tierLabel(lead.proposed_equipment_tier)
                          : lead.equipment_description}
                      </p>
                      {lead.notes && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-1 whitespace-pre-wrap break-words">
                          {lead.notes}
                        </p>
                      )}
                      {lead.equipment && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                          Linked: {[lead.equipment.make, lead.equipment.model].filter(Boolean).join(' ') || lead.equipment.id}
                          {lead.equipment.serial_number ? ` — SN ${lead.equipment.serial_number}` : ''}
                        </p>
                      )}
                      {isEquipmentSale && lead.sale_synergy_order_number && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                          Synergy order #{lead.sale_synergy_order_number}
                          {lead.sale_equipment_tier ? ` · ${tierLabel(lead.sale_equipment_tier)}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {isEquipmentSale
                        ? tierLabel(lead.proposed_equipment_tier)
                        : (lead.proposed_pm_frequency ?? '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(lead.submitted_at)}
                      {isEquipmentSale && lead.expires_at && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          expires {formatDate(lead.expires_at)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${statusBadge(lead.status)}`}>
                        {lead.status}
                      </span>
                      {(lead.status === 'earned' || lead.status === 'paid') && (
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          {formatMoney(lead.bonus_amount)}
                          {lead.earned_at && ` · earned ${formatDate(lead.earned_at)}`}
                          {lead.payout_period && ` · ${lead.payout_period}`}
                        </p>
                      )}
                      {lead.status === 'rejected' && lead.rejected_reason && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-400 max-w-xs whitespace-pre-wrap">
                          {lead.rejected_reason}
                        </p>
                      )}
                      {lead.status === 'cancelled' && lead.cancelled_reason && (
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 max-w-xs whitespace-pre-wrap">
                          {lead.cancelled_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {lead.status === 'pending' && (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setReviewLead(lead)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-md disabled:opacity-50"
                          >
                            Review
                          </button>
                        </div>
                      )}
                      {lead.status === 'approved' && !isEquipmentSale && !lead.equipment_id && (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setEquipLead(lead)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                          >
                            Create equipment
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancel(lead)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {lead.status === 'approved' && !isEquipmentSale && lead.equipment_id && (
                        <div className="flex gap-2 justify-end">
                          <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                            Waiting on first PM
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCancel(lead)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {lead.status === 'approved' && isEquipmentSale && (
                        <div className="flex gap-2 justify-end">
                          <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                            Waiting on Synergy sale
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCancel(lead)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <LeadReviewModal
        lead={reviewLead}
        onClose={() => setReviewLead(null)}
        onDone={() => { setReviewLead(null); router.refresh() }}
      />
      <CreateEquipmentFromLeadModal
        lead={equipLead}
        onClose={() => setEquipLead(null)}
        onDone={() => { setEquipLead(null); router.refresh() }}
      />
    </>
  )
}
