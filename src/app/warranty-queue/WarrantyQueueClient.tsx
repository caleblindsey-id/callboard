'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import type { WarrantyQueueRow, WarrantyBucket } from '@/lib/db/warranty-queue'

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
  return `$${amount.toFixed(2)}`
}

const BUCKETS: { key: WarrantyBucket; title: string; blurb: string }[] = [
  { key: 'to_file', title: 'To file', blurb: 'Warranty work is done — file the claim with the vendor.' },
  { key: 'awaiting_credit', title: 'Awaiting credit', blurb: 'Claim filed — waiting on the vendor credit.' },
  { key: 'received', title: 'Credit received', blurb: 'Credit logged — ready to bill and close.' },
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
      String(r.work_order_number ?? '').includes(q)
    )
  }, [rows, query])

  const byBucket = useMemo(() => {
    const m: Record<WarrantyBucket, WarrantyQueueRow[]> = { to_file: [], awaiting_credit: [], received: [] }
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
              <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                Nothing here.
              </div>
            ) : (
              <div className="space-y-2">
                {byBucket[b.key].map((r) => (
                  <WarrantyClaimCard key={r.id} row={r} />
                ))}
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

  const [vendor, setVendor] = useState(row.warranty_vendor ?? '')
  const [claimNumber, setClaimNumber] = useState(row.warranty_claim_number ?? '')
  const [creditExpected, setCreditExpected] = useState(
    row.warranty_credit_expected != null ? String(row.warranty_credit_expected) : ''
  )
  const [creditAmount, setCreditAmount] = useState(
    row.warranty_credit_amount != null ? String(row.warranty_credit_amount) : ''
  )

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

  const aging =
    row.bucket === 'awaiting_credit'
      ? agingBadge(row.days_since_submitted)
      : agingBadge(row.days_since_completed)
  const agingLabel = row.bucket === 'awaiting_credit' ? 'Filed' : row.bucket === 'received' ? 'Completed' : 'Completed'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/service/${row.id}`}
            className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {row.customer_name}
          </Link>
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
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
            {agingLabel} {aging.label}
          </span>
          {row.bucket === 'to_file' && (
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
              onClick={() => post({ action: 'reset' }, 'Failed to undo')}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Undo credit
            </button>
          )}
        </div>
      </div>

      {open && (row.bucket === 'to_file' || row.bucket === 'awaiting_credit') && (
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Vendor">
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} placeholder="Manufacturer" />
            </Field>
            <Field label="Claim / RMA #">
              <input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} className={inputCls} placeholder="Vendor reference" />
            </Field>
            {row.bucket === 'to_file' ? (
              <Field label="Expected credit">
                <input type="number" step="0.01" min="0" value={creditExpected} onChange={(e) => setCreditExpected(e.target.value)} className={inputCls} placeholder="0.00" />
              </Field>
            ) : (
              <Field label="Credit received">
                <input type="number" step="0.01" min="0" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className={inputCls} placeholder="0.00" />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            {row.bucket === 'to_file' ? (
              <button
                onClick={() => post(
                  { action: 'file', vendor, claim_number: claimNumber, credit_expected: creditExpected || null },
                  'Failed to file the claim',
                )}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Mark filed'}
              </button>
            ) : (
              <button
                onClick={() => post(
                  { action: 'credit', vendor, claim_number: claimNumber, credit_amount: creditAmount || null },
                  'Failed to log the credit',
                )}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Mark credit received'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
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
