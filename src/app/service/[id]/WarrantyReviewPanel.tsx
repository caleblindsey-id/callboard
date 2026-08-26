'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Badge } from './detail-ui'
import ConfirmDialog from '@/components/ConfirmDialog'
import InlineError from '@/components/ui/InlineError'
import { formatDate } from '@/lib/format'
import { partLabel } from '@/lib/parts'
import { WARRANTY_REVIEW_STATUS_LABELS, type WarrantyReviewStatus } from '@/lib/service-tickets/warranty'
import type { ServicePartUsed, ServiceTicketStatus } from '@/types/service-tickets'

// Warranty review lifecycle panel (migration 160, round 2 of the redesign).
// All the flag/verify/deny UI lives here so future rounds barely touch the
// big ServiceTicketDetail file — see ServiceTicketDetail.tsx for the single
// mount point and lib/service-tickets/warranty.ts for the pure helpers this
// consumes. Deliberately does not touch billing_type, pricing, or the
// completion form.

const STATUS_BADGE_CLASSES: Record<WarrantyReviewStatus, string> = {
  requested: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  verified: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const BLOCKED_STATUSES: ServiceTicketStatus[] = ['billed', 'canceled', 'declined']

interface ActivePart {
  index: number
  description: string
  quantity: number
}

interface WarrantyReviewPanelProps {
  ticketId: string
  status: ServiceTicketStatus
  assignedTechnicianId: string | null
  isTech: boolean
  isStaff: boolean
  userId: string
  warrantyReviewStatus: WarrantyReviewStatus | null
  warrantyReviewRequestedAt: string | null
  warrantyReviewRequestedById: string | null
  warrantyReviewNote: string | null
  warrantyReviewDecidedAt: string | null
  warrantyReviewDecisionNote: string | null
  warrantyLaborCovered: boolean
  warrantyVendor: string | null
  warrantyVendorLaborRate: number | null
  requesterName: string | null
  deciderName: string | null
  partsUsed: ServicePartUsed[]
  estimateParts: ServicePartUsed[]
  onChanged?: () => void
}

export default function WarrantyReviewPanel({
  ticketId,
  status,
  assignedTechnicianId,
  isTech,
  isStaff,
  userId,
  warrantyReviewStatus,
  warrantyReviewRequestedAt,
  warrantyReviewRequestedById,
  warrantyReviewNote,
  warrantyReviewDecidedAt,
  warrantyReviewDecisionNote,
  warrantyLaborCovered,
  warrantyVendor,
  warrantyVendorLaborRate,
  requesterName,
  deciderName,
  partsUsed,
  estimateParts,
  onChanged,
}: WarrantyReviewPanelProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Flag form state
  const [flagNote, setFlagNote] = useState('')

  // Unflag confirm
  const [confirmUnflag, setConfirmUnflag] = useState(false)

  // Verdict form state
  const [verdictOpen, setVerdictOpen] = useState(false)
  const [verdict, setVerdict] = useState<'verified' | 'denied'>('verified')
  const [laborCovered, setLaborCovered] = useState(warrantyLaborCovered)
  const [coveredIndexes, setCoveredIndexes] = useState<Set<number>>(new Set())
  const [vendor, setVendor] = useState(warrantyVendor ?? '')
  const [vendorLaborRate, setVendorLaborRate] = useState(
    warrantyVendorLaborRate != null ? String(warrantyVendorLaborRate) : ''
  )
  const [decisionNote, setDecisionNote] = useState('')
  const [denyReason, setDenyReason] = useState('')

  // Active parts list: parts_used if non-empty, else estimate_parts.
  const activePartsField: 'parts_used' | 'estimate_parts' = partsUsed.length > 0 ? 'parts_used' : 'estimate_parts'
  const activeParts: ActivePart[] = (activePartsField === 'parts_used' ? partsUsed : estimateParts).map(
    (p, index) => ({ index, description: partLabel(p) || 'Part', quantity: p.quantity })
  )

  async function post(body: Record<string, unknown>) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}/warranty-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong.')
        return false
      }
      if (onChanged) onChanged()
      router.refresh()
      return true
    } catch {
      setError('Could not save. Try again.')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFlag() {
    const ok = await post({ action: 'flag', note: flagNote })
    if (ok) setFlagNote('')
  }

  async function handleUnflag() {
    const ok = await post({ action: 'unflag' })
    setConfirmUnflag(false)
    if (!ok) return
  }

  function openVerdictForm() {
    setVerdict('verified')
    setLaborCovered(warrantyLaborCovered)
    setCoveredIndexes(new Set())
    setVendor(warrantyVendor ?? '')
    setVendorLaborRate(warrantyVendorLaborRate != null ? String(warrantyVendorLaborRate) : '')
    setDecisionNote('')
    setDenyReason('')
    setVerdictOpen(true)
  }

  function toggleCoveredIndex(index: number) {
    setCoveredIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleSaveVerdict() {
    if (verdict === 'denied') {
      if (denyReason.trim().length < 2) {
        setError('A reason is required to deny warranty coverage.')
        return
      }
      const ok = await post({ action: 'deny', decision_note: denyReason.trim() })
      if (ok) setVerdictOpen(false)
      return
    }

    const rateValue = vendorLaborRate.trim()
    const ok = await post({
      action: 'verify',
      labor_covered: laborCovered,
      covered_part_indexes: activeParts.length > 0 ? Array.from(coveredIndexes) : undefined,
      parts_field: activeParts.length > 0 ? activePartsField : undefined,
      decision_note: decisionNote.trim() || undefined,
      vendor: vendor.trim() || undefined,
      vendor_labor_rate: rateValue ? Number(rateValue) : null,
    })
    if (ok) setVerdictOpen(false)
  }

  const coveredCountLabel = (() => {
    if (activeParts.length === 0) return null
    const source = activePartsField === 'parts_used' ? partsUsed : estimateParts
    const coveredOnDecided = activeParts.filter((p) => source[p.index]?.warranty_covered).length
    return `${coveredOnDecided} of ${activeParts.length} parts covered`
  })()

  // Not flagged yet — show the flag form for tech-on-own-ticket or staff, as
  // long as the ticket can still take on warranty work.
  if (warrantyReviewStatus == null) {
    const canFlag = (isStaff || (isTech && assignedTechnicianId === userId)) && !BLOCKED_STATUSES.includes(status)
    if (!canFlag) return null
    return (
      <Card title="Warranty">
        {error && <InlineError message={error} className="mb-3" />}
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Think this repair is under warranty? Flag it and the office will verify coverage.
        </p>
        <textarea
          value={flagNote}
          onChange={(e) => setFlagNote(e.target.value)}
          placeholder="Why? Machine purchase date, serial, or the part that was recently replaced..."
          rows={3}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={handleFlag}
            disabled={submitting || flagNote.trim().length < 2}
            className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
          >
            {submitting ? 'Flagging...' : 'Flag for warranty review'}
          </button>
        </div>
      </Card>
    )
  }

  const canRemoveFlag =
    isStaff || (isTech && warrantyReviewRequestedById === userId && warrantyReviewStatus === 'requested')

  return (
    <Card title="Warranty">
      {error && <InlineError message={error} className="mb-3" />}

      <div className="flex items-center gap-2 mb-3">
        <Badge label={WARRANTY_REVIEW_STATUS_LABELS[warrantyReviewStatus]} classes={STATUS_BADGE_CLASSES[warrantyReviewStatus]} />
        {warrantyReviewStatus === 'requested' && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {requesterName ?? 'Unknown'} · {formatDate(warrantyReviewRequestedAt)}
          </span>
        )}
        {(warrantyReviewStatus === 'verified' || warrantyReviewStatus === 'denied') && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {deciderName ?? 'Unknown'} · {formatDate(warrantyReviewDecidedAt)}
          </span>
        )}
      </div>

      {warrantyReviewNote && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 whitespace-pre-wrap">
          {warrantyReviewNote}
        </p>
      )}

      {warrantyReviewStatus === 'verified' && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
          {warrantyLaborCovered ? 'Labor covered' : 'Labor not covered'}
          {coveredCountLabel ? ` · ${coveredCountLabel}` : ''}
          {warrantyVendor ? ` · Vendor: ${warrantyVendor}` : ''}
          {warrantyVendorLaborRate != null ? ` ($${warrantyVendorLaborRate}/hr)` : ''}
        </p>
      )}

      {warrantyReviewStatus !== 'requested' && warrantyReviewDecisionNote && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 whitespace-pre-wrap">
          {warrantyReviewDecisionNote}
        </p>
      )}

      {!verdictOpen && (
        <div className="flex flex-wrap gap-2 mt-2">
          {isStaff && (
            <button
              onClick={openVerdictForm}
              disabled={submitting}
              className="px-3 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {warrantyReviewStatus === 'requested' ? 'Review' : 'Change verdict'}
            </button>
          )}
          {canRemoveFlag && (
            <button
              onClick={() => setConfirmUnflag(true)}
              disabled={submitting}
              className="px-3 py-2.5 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              Remove flag
            </button>
          )}
        </div>
      )}

      {isStaff && verdictOpen && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setVerdict('verified')}
              className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors min-h-[44px] sm:min-h-0 ${
                verdict === 'verified'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              }`}
            >
              Verified covered
            </button>
            <button
              onClick={() => setVerdict('denied')}
              className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors min-h-[44px] sm:min-h-0 ${
                verdict === 'denied'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              }`}
            >
              Denied
            </button>
          </div>

          {verdict === 'verified' ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={laborCovered}
                  onChange={(e) => setLaborCovered(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                />
                Labor covered
              </label>

              {activeParts.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wide mb-1">
                    Parts
                  </p>
                  <div className="space-y-1">
                    {activeParts.map((p) => (
                      <label key={p.index} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={coveredIndexes.has(p.index)}
                          onChange={() => toggleCoveredIndex(p.index)}
                          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                        />
                        {p.description} (qty {p.quantity}), covered
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Vendor</label>
                  <input
                    type="text"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Vendor labor rate ($/hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={vendorLaborRate}
                    onChange={(e) => setVendorLaborRate(e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] sm:min-h-0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Decision note (optional)</label>
                <textarea
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Reason (required)</label>
              <textarea
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                placeholder="e.g. serial out of warranty period"
                rows={2}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setVerdictOpen(false)}
              disabled={submitting}
              className="px-4 py-2.5 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveVerdict}
              disabled={submitting}
              className="px-4 py-2.5 sm:py-2 text-sm font-medium text-white bg-slate-700 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmUnflag}
        title="Remove warranty flag"
        message="This clears the warranty review request. You can flag it again later."
        confirmLabel="Remove flag"
        confirmVariant="danger"
        onConfirm={handleUnflag}
        onCancel={() => setConfirmUnflag(false)}
        loading={submitting}
      />
    </Card>
  )
}
