'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import type { WarrantyQueueRow, WarrantyBucket } from '@/lib/db/warranty-queue'
import type { ServiceTicketStatus } from '@/types/service-tickets'
import ConfirmDialog from '@/components/ConfirmDialog'
import QueueActionCard from '@/components/ui/QueueActionCard'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import { formatDate } from '@/lib/format'

// Response shape of POST warranty-claim { action: 'suggest' }. See
// src/lib/service-tickets/warranty-server.ts and the route for the source.
type ClaimSuggestion = {
  amount: number
  unknownCostParts: number
  lines: { index: number; description: string; qty: number; covered: boolean; unitCost: number | null }[]
  hoursWorked: number
  vendorLaborRate: number | null
  laborCovered: boolean
}

// Aging tightens the longer a claim sits — an unfiled claim or an uncredited one
// is parts cost the branch is carrying. Same escalation feel as the other queues.
function agingBadge(days: number | null): { label: string; classes: string } {
  if (days == null) return { label: '—', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 6) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 13) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  if (days <= 29) return { label, classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

function fmtMoney(amount: number | null | undefined): string {
  if (amount == null) return '—'
  // Postgres numeric columns can arrive over PostgREST as a string; coerce
  // before .toFixed() or an unattended numeric-as-string throws.
  return `$${Number(amount).toFixed(2)}`
}

// Which clock a bucket ages off, and the label that goes with it. to_review
// ages off when the tech flagged it (it can still be sitting open/in_progress,
// unlike the other buckets which only ever hold completed/billed work).
function agingClock(row: WarrantyQueueRow): { days: number | null; label: string } {
  if (row.bucket === 'to_review') return { days: row.days_since_requested, label: 'Requested' }
  if (row.bucket === 'awaiting_credit') return { days: row.days_since_submitted, label: 'Filed' }
  return { days: row.days_since_completed, label: 'Completed' }
}

const BUCKETS: { key: WarrantyBucket; title: string; blurb: string }[] = [
  {
    key: 'to_review',
    title: 'To verify',
    blurb:
      'Flagged by a tech as possible warranty. Verify the serial or part is in its warranty period, then record the verdict on the ticket.',
  },
  { key: 'to_file', title: 'To file', blurb: 'Warranty work is done — file the claim with the vendor.' },
  { key: 'awaiting_credit', title: 'Awaiting credit', blurb: 'Claim filed — waiting on the vendor credit.' },
  { key: 'received', title: 'Credit received', blurb: 'Credit logged — ready to bill and close.' },
  {
    key: 'billed_unclaimed',
    title: 'Billed, never claimed',
    blurb:
      'Invoiced to the customer with no vendor claim on file — the credit is lost unless it is chased.',
  },
]

export default function WarrantyQueueClient({ rows }: { rows: WarrantyQueueRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.customer_name.toLowerCase().includes(q) ||
      r.equipment_label.toLowerCase().includes(q) ||
      (r.serial_number ?? '').toLowerCase().includes(q) ||
      (r.warranty_vendor ?? '').toLowerCase().includes(q) ||
      (r.warranty_claim_number ?? '').toLowerCase().includes(q) ||
      (r.warranty_review_note ?? '').toLowerCase().includes(q) ||
      (r.requested_by_name ?? '').toLowerCase().includes(q) ||
      String(r.work_order_number ?? '').includes(q)
    )
  }, [rows, query])

  const byBucket = useMemo(() => {
    const m: Record<WarrantyBucket, WarrantyQueueRow[]> = {
      to_review: [],
      to_file: [],
      awaiting_credit: [],
      received: [],
      billed_unclaimed: [],
    }
    for (const r of filtered) m[r.bucket].push(r)
    return m
  }, [filtered])

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {rows.length} warranty claim{rows.length === 1 ? '' : 's'} in flight
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer, equipment, vendor, claim#, WO#"
          className="w-full sm:w-80 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <ShieldCheck className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          No open warranty claims.
        </div>
      ) : (
        BUCKETS.map((b) => (
          <section key={b.key} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{b.title}</h2>
              <span className="text-sm text-gray-400 dark:text-gray-500 tabular-nums">{byBucket[b.key].length}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">{b.blurb}</p>
            {byBucket[b.key].length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">{b.title}: none</p>
            ) : (
              <div className="space-y-2">
                {byBucket[b.key].map((r) =>
                  b.key === 'to_review' ? (
                    <ToReviewCard key={r.id} row={r} />
                  ) : (
                    <WarrantyClaimCard key={r.id} row={r} />
                  )
                )}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  )
}

function WarrantyClaimCard({ row }: { row: WarrantyQueueRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState(false)

  const [vendor, setVendor] = useState(row.warranty_vendor ?? '')
  const [claimNumber, setClaimNumber] = useState(row.warranty_claim_number ?? '')
  const [creditExpected, setCreditExpected] = useState(
    row.warranty_credit_expected != null ? String(row.warranty_credit_expected) : ''
  )
  const [vendorLaborRate, setVendorLaborRate] = useState(
    row.warranty_vendor_labor_rate != null ? String(row.warranty_vendor_labor_rate) : ''
  )
  // Reconcile-only: actual credit per covered part (keyed by parts_used
  // index) and the actual labor credit, seeded from whatever's already saved.
  const [partCredits, setPartCredits] = useState<Record<number, string>>(() => {
    const seed: Record<number, string> = {}
    for (const p of row.covered_parts) {
      seed[p.index] = p.vendor_credit_amount != null ? String(p.vendor_credit_amount) : ''
    }
    return seed
  })
  const [laborCreditInput, setLaborCreditInput] = useState(
    row.warranty_labor_credit_amount != null ? String(row.warranty_labor_credit_amount) : ''
  )

  // Suggested/expected credit, fetched once on expand — powers the file-claim
  // prefill and the reconcile modal's per-line expected column.
  const [suggestion, setSuggestion] = useState<ClaimSuggestion | null>(null)
  const [suggestionLoading, setSuggestionLoading] = useState(false)

  // A billed-but-never-claimed ticket needs exactly the same action as a
  // to-file one: record the vendor and claim number so the credit can still
  // be chased. The only difference is that the customer was already invoiced.
  const isFiling = row.bucket === 'to_file' || row.bucket === 'billed_unclaimed'
  const isReconciling = row.bucket === 'awaiting_credit'

  useEffect(() => {
    if (!open || suggestion || suggestionLoading || !(isFiling || isReconciling)) return
    setSuggestionLoading(true)
    fetch(`/api/service-tickets/${row.id}/warranty-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggest' }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<ClaimSuggestion>) : null))
      .then((data) => {
        if (!data) return
        setSuggestion(data)
        if (isFiling) setCreditExpected(String(data.amount))
      })
      .finally(() => setSuggestionLoading(false))
  }, [open, suggestion, suggestionLoading, isFiling, isReconciling, row.id])

  async function post(payload: Record<string, unknown>, failMsg: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${row.id}/warranty-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || failMsg)
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : failMsg)
    } finally {
      setBusy(false)
    }
  }

  function submitCredit() {
    const part_credits = Object.fromEntries(
      Object.entries(partCredits).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)])
    )
    post(
      {
        action: 'credit',
        vendor,
        claim_number: claimNumber,
        labor_credit_amount: row.warranty_labor_covered
          ? (laborCreditInput.trim() === '' ? null : Number(laborCreditInput))
          : undefined,
        part_credits,
      },
      'Failed to log the credit',
    )
  }

  // Expected per covered part comes from the suggest endpoint's unit cost
  // (unknown until it loads); the row itself only carries the customer price.
  const reconcileParts = row.covered_parts.map((p) => {
    const unitCost = suggestion?.lines.find((l) => l.index === p.index)?.unitCost ?? null
    return { ...p, unitCost, expected: unitCost != null ? p.qty * unitCost : null }
  })
  const laborExpected =
    row.warranty_labor_covered && row.hours_worked != null && row.warranty_vendor_labor_rate
      ? row.hours_worked * row.warranty_vendor_labor_rate
      : null
  const actualTotal =
    (laborCreditInput.trim() === '' ? 0 : Number(laborCreditInput) || 0) +
    Object.values(partCredits).reduce((sum, v) => sum + (v.trim() === '' ? 0 : Number(v) || 0), 0)

  const clock = agingClock(row)
  const aging = agingBadge(clock.days)
  const agingLabel = clock.label

  return (
    <>
    <QueueActionCard
      title={
        <Link
          href={`/service/${row.id}`}
          className="hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {row.customer_name}
        </Link>
      }
      sub={
        <>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
            {row.work_order_number != null && <span>WO-{row.work_order_number}</span>}
            <span>{row.equipment_label}{row.serial_number ? ` · S/N ${row.serial_number}` : ''}</span>
            {row.technician_name && <span>Tech: {row.technician_name}</span>}
            {row.billing_type === 'partial_warranty' && <span className="text-amber-600 dark:text-amber-400">Partial warranty</span>}
          </div>
          {(row.warranty_vendor || row.warranty_claim_number) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {row.warranty_vendor && <span>Vendor: {row.warranty_vendor}</span>}
              {row.warranty_claim_number && <span>{row.warranty_vendor ? ' · ' : ''}Claim #{row.warranty_claim_number}</span>}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3">
            {row.warranty_credit_expected != null && <span>Expected credit {fmtMoney(row.warranty_credit_expected)}</span>}
            {row.warranty_credit_amount != null && <span>Credit received {fmtMoney(row.warranty_credit_amount)}</span>}
          </div>
          {row.bucket === 'received' && row.warranty_credit_expected != null && row.warranty_credit_amount != null && (
            <RecoveryDelta expected={row.warranty_credit_expected} received={row.warranty_credit_amount} />
          )}
        </>
      }
      badge={
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
          {agingLabel} {aging.label}
        </span>
      }
      actions={
        <>
          {isFiling && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
            >
              File claim
            </button>
          )}
          {row.bucket === 'awaiting_credit' && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="px-3 py-1.5 text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/40"
            >
              Log credit
            </button>
          )}
          {row.bucket === 'received' && (
            <button
              onClick={() => setConfirmingUndo(true)}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Undo credit
            </button>
          )}
        </>
      }
      expanded={
        open && (isFiling || isReconciling) ? (
          <>
            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            {isFiling ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <Field label="Vendor">
                    <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} placeholder="Manufacturer" />
                  </Field>
                  <Field label="Claim / RMA #">
                    <input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} className={inputCls} placeholder="Vendor reference" />
                  </Field>
                  <Field label="Vendor labor rate ($/hr)">
                    <input type="number" step="0.01" min="0" value={vendorLaborRate} onChange={(e) => setVendorLaborRate(e.target.value)} className={inputCls} placeholder="0.00" />
                  </Field>
                  <Field label="Expected credit">
                    <input type="number" step="0.01" min="0" value={creditExpected} onChange={(e) => setCreditExpected(e.target.value)} className={inputCls} placeholder="0.00" />
                  </Field>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {suggestionLoading
                    ? 'Estimating expected credit…'
                    : suggestion && (
                        <>
                          Based on {row.covered_parts.length} covered part{row.covered_parts.length === 1 ? '' : 's'} at cost
                          {row.warranty_labor_covered && suggestion.vendorLaborRate
                            ? ` + ${suggestion.hoursWorked.toFixed(2)} hrs × ${fmtMoney(suggestion.vendorLaborRate)}/hr`
                            : ''}
                          {suggestion.unknownCostParts > 0
                            ? ` (+ ${suggestion.unknownCostParts} part${suggestion.unknownCostParts === 1 ? '' : 's'} with unknown cost, not included)`
                            : ''}
                          .
                        </>
                      )}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => post(
                      {
                        action: 'file',
                        vendor,
                        claim_number: claimNumber,
                        credit_expected: creditExpected || null,
                        vendor_labor_rate: vendorLaborRate || null,
                      },
                      'Failed to file the claim',
                    )}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Mark filed'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Vendor">
                    <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} placeholder="Manufacturer" />
                  </Field>
                  <Field label="Claim / RMA #">
                    <input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} className={inputCls} placeholder="Vendor reference" />
                  </Field>
                </div>
                <div className="space-y-2">
                  {reconcileParts.map((p) => (
                    <div key={p.index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                      <div className="sm:col-span-2 text-sm text-gray-700 dark:text-gray-300">
                        {p.description} <span className="text-gray-400 dark:text-gray-500">×{p.qty}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Expected {suggestionLoading ? '…' : p.expected != null ? fmtMoney(p.expected) : '—'}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={partCredits[p.index] ?? ''}
                        onChange={(e) => setPartCredits((prev) => ({ ...prev, [p.index]: e.target.value }))}
                        className={inputCls}
                        placeholder="Actual credit"
                      />
                    </div>
                  ))}
                  {row.warranty_labor_covered && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end border-t border-gray-100 dark:border-gray-800 pt-2">
                      <div className="sm:col-span-2 text-sm text-gray-700 dark:text-gray-300">
                        Labor <span className="text-gray-400 dark:text-gray-500">×{(row.hours_worked ?? 0).toFixed(2)} hrs</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Expected {laborExpected != null ? fmtMoney(laborExpected) : '—'}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={laborCreditInput}
                        onChange={(e) => setLaborCreditInput(e.target.value)}
                        className={inputCls}
                        placeholder="Actual credit"
                      />
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3">
                  <span>Actual total {fmtMoney(actualTotal)}</span>
                  {row.warranty_credit_expected != null && <span>of {fmtMoney(row.warranty_credit_expected)} expected</span>}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitCredit}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Mark credit received'}
                  </button>
                </div>
              </>
            )}
          </>
        ) : null
      }
    />

    <ConfirmDialog
      open={confirmingUndo}
      title="Undo credit received"
      message={`Reverse the vendor credit${row.warranty_credit_amount != null ? ` of ${fmtMoney(row.warranty_credit_amount)}` : ''} logged for ${row.customer_name}${row.work_order_number != null ? ` (WO-${row.work_order_number})` : ''}${row.warranty_claim_number ? `, claim #${row.warranty_claim_number}` : ''}? The claim moves back to "Awaiting credit."`}
      confirmLabel="Undo credit"
      confirmVariant="danger"
      loading={busy}
      onConfirm={() => {
        setConfirmingUndo(false)
        post({ action: 'reset' }, 'Failed to undo')
      }}
      onCancel={() => setConfirmingUndo(false)}
    />
    </>
  )
}

// Internal margin-loss visibility, never a customer-facing figure or a
// blocker: what the vendor actually credited vs. what was expected at file
// time. A shortfall means the branch is eating the gap.
function RecoveryDelta({ expected, received }: { expected: number; received: number }) {
  const delta = Number(received) - Number(expected)
  return (
    <div
      className={`text-xs mt-1 ${delta < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}
    >
      Recovered {fmtMoney(received)} of {fmtMoney(expected)} expected
      {delta < 0 && <span> (short {fmtMoney(Math.abs(delta))})</span>}
    </div>
  )
}

// A to_review row is still an open ticket, not a completed one waiting on
// office paperwork — there's nothing to file or credit here yet, only a
// verdict to make. The verdict form itself lives on the ticket detail page
// (WarrantyReviewPanel), so this card's only job is to surface the tech's
// case and point the manager there.
function ToReviewCard({ row }: { row: WarrantyQueueRow }) {
  const clock = agingClock(row)
  const aging = agingBadge(clock.days)

  return (
    <QueueActionCard
      title={
        <Link
          href={`/service/${row.id}`}
          className="hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {row.customer_name}
        </Link>
      }
      sub={
        <>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.work_order_number != null && <span>WO-{row.work_order_number}</span>}
            <span>{row.equipment_label}{row.serial_number ? ` · S/N ${row.serial_number}` : ''}</span>
            <ServiceStatusBadge status={row.status as ServiceTicketStatus} />
          </div>
          {row.warranty_review_note && (
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">&ldquo;{row.warranty_review_note}&rdquo;</p>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {row.requested_by_name && <span>{row.requested_by_name}</span>}
            {row.warranty_review_requested_at && (
              <span>{row.requested_by_name ? ' · ' : ''}{formatDate(row.warranty_review_requested_at)}</span>
            )}
          </div>
        </>
      }
      badge={
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
          {clock.label} {aging.label}
        </span>
      }
      actions={
        <Link
          href={`/service/${row.id}`}
          className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
        >
          Review on ticket
        </Link>
      }
    />
  )
}

const inputCls =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
