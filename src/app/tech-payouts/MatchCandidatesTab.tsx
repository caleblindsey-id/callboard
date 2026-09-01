'use client'

import { useState } from 'react'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import type { CandidateWithLead } from '@/lib/db/equipment-sale-candidates'
import { tierLabel } from '@/lib/tech-leads/bonus-tiers'
import ConfirmMatchModal from './ConfirmMatchModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatMoney, formatDate } from '@/lib/format'

interface Props {
  leads: TechLeadWithJoins[]
  candidatesByLead: Record<string, CandidateWithLead[]>
  onRefresh: () => void
}

// The whole judgment on this tab is "is the machine on that Synergy order the
// replacement for the machine the tech flagged?" -- so the flagged machine has to
// be on screen. It used to be missing entirely, leaving the reviewer to guess from
// the tier dropdown alone. Every field here is already on the lead row; no extra
// query.
function FlaggedMachine({ lead }: { lead: TechLeadWithJoins }) {
  const identity = [lead.make, lead.model].filter(Boolean).join(' ')
  const details: string[] = []
  if (lead.serial_number) details.push(`S/N ${lead.serial_number}`)
  if (lead.location_on_site) details.push(lead.location_on_site)
  if (lead.quoted_amount) details.push(`Quoted ${lead.quoted_amount}`)

  const description = lead.equipment_description?.trim()
  // equipment_description mirrors the tier label on equipment-sale leads, so it is
  // only worth showing when the tech actually wrote something more specific.
  const showDescription =
    description && description.toLowerCase() !== tierLabel(lead.proposed_equipment_tier).toLowerCase()

  if (!identity && !details.length && !showDescription) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
        Tech recorded no make, model or serial for the flagged machine.
      </p>
    )
  }

  return (
    <div className="mt-1.5 text-xs">
      <span className="text-gray-500 dark:text-gray-400">Flagged machine: </span>
      <span className="text-gray-900 dark:text-gray-200 font-medium">
        {identity || 'unspecified'}
      </span>
      {details.length > 0 && (
        <span className="text-gray-500 dark:text-gray-400"> · {details.join(' · ')}</span>
      )}
      {showDescription && (
        <span className="text-gray-500 dark:text-gray-400"> · {description}</span>
      )}
    </div>
  )
}

export default function MatchCandidatesTab({ leads, candidatesByLead, onRefresh }: Props) {
  const [activeCandidate, setActiveCandidate] = useState<CandidateWithLead | null>(null)
  const [activeProposedTier, setActiveProposedTier] = useState<TechLeadWithJoins['proposed_equipment_tier']>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Inline replacement for window.confirm — null = closed.
  const [pendingDismissLeadId, setPendingDismissLeadId] = useState<string | null>(null)
  const [dismissAllReason, setDismissAllReason] = useState('')

  const leadsWithCandidates = leads.filter(l => (candidatesByLead[l.id] ?? []).length > 0)

  async function performDismissAll(leadId: string) {
    setBusyId(leadId)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${leadId}/candidates/dismiss-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: dismissAllReason.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to dismiss candidates.')
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dismiss candidates.')
    } finally {
      setBusyId(null)
      setPendingDismissLeadId(null)
      setDismissAllReason('')
    }
  }

  if (leadsWithCandidates.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No pending match candidates. The nightly scan populates this tab when a flagged customer buys equipment in Synergy.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {leadsWithCandidates.map(lead => {
        const candidates = candidatesByLead[lead.id] ?? []
        const customer = lead.customers?.name || lead.customer_name_text || '—'
        const isBusy = busyId === lead.id
        return (
          <div key={lead.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">{customer}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Submitted {formatDate(lead.submitted_at)} by {lead.submitter?.name ?? 'unknown'} ·{' '}
                  Tech tier guess: <strong>{tierLabel(lead.proposed_equipment_tier)}</strong>
                  {lead.notes && ` · ${lead.notes}`}
                </p>
                <FlaggedMachine lead={lead} />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setDismissAllReason(''); setPendingDismissLeadId(lead.id) }}
                  disabled={isBusy}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Dismiss all
                </button>
              </div>
            </div>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {candidates.map(c => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap justify-between gap-3 mb-2">
                    <div className="text-sm">
                      <p className="font-medium text-gray-900 dark:text-white">
                        Synergy order #{c.synergy_order_number}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(c.synergy_order_date)} · Total {formatMoney(c.synergy_order_total)} · {c.order_lines.length} equipment line{c.order_lines.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCandidate(c)
                        setActiveProposedTier(lead.proposed_equipment_tier)
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
                    >
                      Review &amp; confirm
                    </button>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Item #</th>
                          <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Description</th>
                          <th className="px-3 py-2 text-right font-medium uppercase tracking-wider">Qty</th>
                          <th className="px-3 py-2 text-right font-medium uppercase tracking-wider">Unit price</th>
                          <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Code</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {c.order_lines.map((ln, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-gray-900 dark:text-white">{ln.prod_code}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{ln.description ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{ln.qty ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{formatMoney(ln.unit_price)}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{ln.comdty_code ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <ConfirmMatchModal
        candidate={activeCandidate}
        proposedTier={activeProposedTier}
        onClose={() => setActiveCandidate(null)}
        onDone={() => { setActiveCandidate(null); onRefresh() }}
      />

      <ConfirmDialog
        open={pendingDismissLeadId !== null}
        title="Dismiss all candidates?"
        message="Dismiss ALL candidates on this lead? The lead will go back to Approved and wait for new matches."
        confirmLabel="Dismiss all"
        confirmVariant="danger"
        loading={pendingDismissLeadId !== null && busyId === pendingDismissLeadId}
        onCancel={() => { setPendingDismissLeadId(null); setDismissAllReason('') }}
        onConfirm={() => {
          if (pendingDismissLeadId) performDismissAll(pendingDismissLeadId)
        }}
      >
        <label
          htmlFor="dismiss-all-reason"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Why not? (optional)
        </label>
        <textarea
          id="dismiss-all-reason"
          value={dismissAllReason}
          onChange={e => setDismissAllReason(e.target.value)}
          rows={2}
          placeholder="e.g. none of these are the machine the tech flagged"
          className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </ConfirmDialog>
    </div>
  )
}
