'use client'

import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Download, BarChart3 } from 'lucide-react'
import KpiCard from '@/components/analytics/KpiCard'
import ScrollableTable from '@/components/ScrollableTable'
import { formatDate } from '@/lib/format'
import type { SupplyReport } from '@/lib/db/supply-requests'

// recharts is heavy + SSR-unfriendly — load it client-only, like AnalyticsOverview.
const SupplyTrendChart = dynamic(() => import('./SupplyTrendChart'), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded bg-gray-100 dark:bg-gray-700" />,
})

const RANGES: { key: string; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
  { key: 'all', label: 'All time' },
]

// Self-contained CSV helpers (each client defines its own — see parts-queue / worklist).
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function downloadCsv(header: string[], rows: (string | number)[][], filename: string) {
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) lines.push(r.map(csvCell).join(','))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, filename)
}

export default function SupplyReportClient({ report, range }: { report: SupplyReport; range: string }) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const { kpis, byItem, byTech, byPeriod } = report

  function exportItems() {
    downloadCsv(
      ['Item', 'Unit', 'Times requested', 'Total qty'],
      byItem.map((i) => [i.name, i.unit ?? '', i.timesRequested, i.totalQty]),
      `supply-report-by-item-${today}.csv`,
    )
  }
  function exportTechs() {
    downloadCsv(
      ['Technician', 'Requests', 'Items', 'Last request'],
      byTech.map((t) => [t.techName, t.requests, t.items, formatDate(t.lastRequestedAt)]),
      `supply-report-by-tech-${today}.csv`,
    )
  }

  const isEmpty = kpis.totalRequests === 0

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 w-fit">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => router.push(`/supply-requests/report?range=${r.key}`)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                range === r.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{report.rangeLabel}</span>
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No supply requests in this period.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Requests" value={kpis.totalRequests} format="number" />
            <KpiCard label="Items requested" value={kpis.totalItems} format="number" />
            <KpiCard label="Techs requesting" value={kpis.activeTechs} format="number" />
            <KpiCard label="Denied" value={kpis.deniedCount} format="number" subtitle={`${kpis.fulfilledCount} picked up`} />
          </div>

          {/* Trend */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Requests per {report.granularity}
              </h3>
            </div>
            <div className="px-4 py-4">
              <SupplyTrendChart data={byPeriod} />
            </div>
          </div>

          {/* By item */}
          <ReportTable
            title="Most requested supplies"
            onExport={exportItems}
            head={['Item', 'Unit', 'Times requested', 'Total qty']}
            rightAlign={[false, false, true, true]}
            rows={byItem.map((i) => [i.name, i.unit ?? '—', String(i.timesRequested), String(i.totalQty)])}
          />

          {/* By tech */}
          <ReportTable
            title="Requests by technician"
            onExport={exportTechs}
            head={['Technician', 'Requests', 'Items', 'Last request']}
            rightAlign={[false, true, true, false]}
            rows={byTech.map((t) => [t.techName, String(t.requests), String(t.items), formatDate(t.lastRequestedAt)])}
          />
        </>
      )}
    </div>
  )
}

function ReportTable({
  title,
  onExport,
  head,
  rows,
  rightAlign,
}: {
  title: string
  onExport: () => void
  head: string[]
  rows: string[][]
  rightAlign: boolean[]
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>
      <ScrollableTable>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`px-5 py-3 font-medium text-gray-600 dark:text-gray-400 ${rightAlign[i] ? 'text-right' : 'text-left'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-5 py-3 ${rightAlign[ci] ? 'text-right tabular-nums' : 'text-left'} ${
                      ci === 0 ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  )
}
