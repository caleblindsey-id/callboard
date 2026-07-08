'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { InvoicedRow } from '@/lib/db/invoiced'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

// Read-only archive of completed + invoiced work orders (service + PM), so a
// billed ticket can still be referenced after it leaves the active billing
// queues. Month picker narrows by billed_at; a type toggle filters PM vs Service.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const ALL_MONTHS = 0

interface InvoicedArchiveProps {
  rows: InvoicedRow[]
  selectedMonth?: number
  selectedYear?: number
}

type TypeFilter = 'all' | 'service' | 'pm'

type InvoicedSortKey =
  | 'type'
  | 'customer'
  | 'wo'
  | 'synergyOrder'
  | 'invoice'
  | 'amount'
  | 'completed'
  | 'billed'

const SORT_ACCESSORS: SortAccessors<InvoicedRow, InvoicedSortKey> = {
  type: r => r.type,
  customer: r => r.customer_name,
  wo: r => r.work_order_number,
  synergyOrder: r => r.synergy_order_number,
  invoice: r => r.synergy_invoice_number,
  amount: r => r.billing_amount,
  completed: r => r.completed_at,
  billed: r => r.billed_at,
}

function TypeBadge({ type }: { type: 'service' | 'pm' }) {
  return type === 'pm' ? (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
      PM
    </span>
  ) : (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
      Service
    </span>
  )
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

export default function InvoicedArchive({ rows, selectedMonth, selectedYear }: InvoicedArchiveProps) {
  const router = useRouter()
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(selectedMonth ?? ALL_MONTHS)
  const [year, setYear] = useState(selectedYear ?? thisYear)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const filtered = rows.filter((r) => typeFilter === 'all' || r.type === typeFilter)
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<InvoicedRow, InvoicedSortKey>(
    filtered,
    SORT_ACCESSORS
  )

  const total = filtered.reduce((sum, r) => sum + (r.billing_amount ?? 0), 0)

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth)
    setYear(newYear)
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    )
    if (newMonth === ALL_MONTHS) {
      params.delete('month')
      params.delete('year')
    } else {
      params.set('month', String(newMonth))
      params.set('year', String(newYear))
    }
    // Keep the active tab so we stay on Invoiced.
    params.set('tab', 'invoiced')
    router.push(`/billing?${params.toString()}`)
  }

  const counts = {
    all: rows.length,
    service: rows.filter((r) => r.type === 'service').length,
    pm: rows.filter((r) => r.type === 'pm').length,
  }

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Invoiced{filtered.length > 0 ? ` (${filtered.length})` : ''}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Completed work orders that have been billed. Reference only. Service tickets also appear on the Service board&apos;s Billed tab.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Billed month</label>
            <select
              value={month}
              onChange={(e) => handleMonthChange(parseInt(e.target.value), year)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value={ALL_MONTHS}>All months</option>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <select
              value={year}
              disabled={month === ALL_MONTHS}
              onChange={(e) => handleMonthChange(month, parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto lg:ml-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(['all', 'service', 'pm'] as TypeFilter[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTypeFilter(tf)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    typeFilter === tf
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {tf === 'all' ? 'All' : tf === 'service' ? 'Service' : 'PM'} ({counts[tf]})
                </button>
              ))}
            </div>
          </div>
        </div>
        {filtered.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filtered.length} invoiced · ${total.toFixed(2)} total
          </p>
        )}
      </div>

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {month === ALL_MONTHS
              ? 'No invoiced work orders yet.'
              : 'No work orders invoiced in this period.'}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((r) => (
                <div key={`${r.type}-${r.id}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={r.type} />
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {r.customer_name ?? '—'}
                        </p>
                      </div>
                      {r.account_number && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">Acct #{r.account_number}</p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {r.work_order_number != null ? `WO#${r.work_order_number} · ` : ''}
                        Inv {r.synergy_invoice_number ?? '—'}
                        {r.synergy_order_number ? ` · Ord ${r.synergy_order_number}` : ''}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Completed {fmtDate(r.completed_at)} · Billed {fmtDate(r.billed_at)}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white shrink-0">
                      {r.billing_amount != null ? `$${r.billing_amount.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="WO#" colKey="wo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Synergy Order #" colKey="synergyOrder" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Synergy Invoice #" colKey="invoice" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Amount" colKey="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Billed" colKey="billed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((r) => (
                    <tr key={`${r.type}-${r.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3"><TypeBadge type={r.type} /></td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {r.customer_name ?? '—'}
                        {r.account_number && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">Acct #{r.account_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {r.work_order_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {r.synergy_order_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {r.synergy_invoice_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                        {r.billing_amount != null ? `$${r.billing_amount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(r.completed_at)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(r.billed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>
    </div>
  )
}
