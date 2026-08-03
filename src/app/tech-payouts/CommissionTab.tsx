'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { formatRate } from '@/lib/commission/tiers'
// Types come from @/lib/commission/report-types, NOT @/lib/db/commission --
// that module imports the server-only Supabase client and breaks the build when
// pulled into a client component.
import {
  BUCKET_LABEL,
  SUBTOTAL_BUCKETS,
  type CommissionReport,
  type CommissionRow,
} from '@/lib/commission/report-types'
import { toCsv, downloadCsv } from '@/lib/csv'
import ScrollableTable from '@/components/ScrollableTable'

interface Props {
  report: CommissionReport
  availablePeriods: string[]
}

// Commission on billed labor, the payout bucket CallBoard has never owned.
// Read-only: everything is computed live from synergy_labor_facts + ACE +
// earned leads. Nothing is written, and no period is locked yet.
//
// Column order deliberately mirrors the manual workbook (rows 6-10, then the
// tiered subtotal, then row 14's flat bonuses) so Caleb can diff this against
// the spreadsheet during changeover without re-reading a new layout.
//
// EVERY technician is listed, including the non-commissioned ones, at 0%. The
// workbook has always carried them that way and the report cannot tie to it
// otherwise. Eligibility is a toggle in Settings → Rates & Billing → Commission.

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  // Noon UTC keeps the month name stable in any render zone.
  return new Date(Date.UTC(y, m - 1, 15, 12)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function CommissionTab({ report, availablePeriods }: Props) {
  const router = useRouter()
  const [period, setPeriod] = useState(report.period)
  const [showZero, setShowZero] = useState(false)

  function changePeriod(next: string) {
    setPeriod(next)
    router.push(`/tech-payouts?tab=commission&period=${next}`)
  }

  const visible = showZero
    ? report.rows
    : report.rows.filter((r) => r.subtotal !== 0 || r.total !== 0)

  function exportCsv() {
    const header = [
      'Synergy ID', 'Tech', 'Commissioned',
      ...SUBTOTAL_BUCKETS.map((b) => BUCKET_LABEL[b]),
      'ACE labor', 'Subtotal', 'Rate', 'Commission',
      'PM bonus', 'Equipment bonus', 'Total payout',
      'To next tier', 'Gain at next tier',
    ]
    const toRow = (r: CommissionRow) => [
      r.synergyId ?? '',
      r.name,
      r.commissionEligible ? 'Yes' : 'No',
      ...SUBTOTAL_BUCKETS.map((b) => r.labor[b].toFixed(2)),
      r.aceLabor.toFixed(2),
      r.subtotal.toFixed(2),
      formatRate(r.rate) + (r.rateIsOverride ? ' (override)' : ''),
      r.commission.toFixed(2),
      r.pmBonus.toFixed(2),
      r.equipmentBonus.toFixed(2),
      r.total.toFixed(2),
      r.nextTier ? r.nextTier.amountAway.toFixed(2) : '',
      r.nextTier ? r.nextTier.gain.toFixed(2) : '',
    ]
    // Off-roster rows ride along so the export accounts for every dollar the
    // report knows about, not just the ones on the roster table.
    downloadCsv(
      `commission_${period}.csv`,
      toCsv(header, [...visible.map(toRow), ...report.offRosterRows.map(toRow)]),
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="commission-period"
            className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
          >
            Period
          </label>
          <select
            id="commission-period"
            value={period}
            onChange={(e) => changePeriod(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
          >
            {availablePeriods.length === 0 && <option value={period}>{periodLabel(period)}</option>}
            {availablePeriods.map((p) => (
              <option key={p} value={p}>{periodLabel(p)}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-1.5">
          <input
            type="checkbox"
            checked={showZero}
            onChange={(e) => setShowZero(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Show techs with no activity
        </label>

        <button
          type="button"
          onClick={exportCsv}
          disabled={visible.length === 0}
          className="ml-auto rounded-md bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-sm font-medium text-white dark:text-gray-900 disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      {/* Empty state: the sync has not run for this period */}
      {report.isEmpty && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">No labor synced for {periodLabel(period)}.</p>
          <p className="mt-1">
            The Synergy labor sync runs daily at 5:45 AM. Commission cannot be computed
            until it has pulled this period. Bonuses and ACE labor below, if any, are
            real but the subtotal is incomplete.
          </p>
        </div>
      )}

      {/* Labor the ERP attributed to someone CallBoard does not know */}
      {report.unmappedLabor.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">
            Labor attributed to {report.unmappedLabor.length} Synergy code
            {report.unmappedLabor.length === 1 ? '' : 's'} with no CallBoard user.
          </p>
          <p className="mt-1">
            These dollars are in Synergy but cannot reach a payout:{' '}
            {report.unmappedLabor
              .map((u) => `${u.synergyId} (${formatMoney(u.amount)})`)
              .join(', ')}
            . If one of these is a technician, set their Synergy ID on the user record.
            Known outside sales reps are already excluded from this warning, so a code
            appearing here is genuinely unaccounted for.
          </p>
        </div>
      )}

      {/* The report */}
      <ScrollableTable className="rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Tech</th>
              {SUBTOTAL_BUCKETS.map((b) => (
                <th key={b} className="px-3 py-2 text-right">{BUCKET_LABEL[b]}</th>
              ))}
              <th className="px-3 py-2 text-right">ACE</th>
              <th className="px-3 py-2 text-right font-bold">Subtotal</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Commission</th>
              <th className="px-3 py-2 text-right">Bonuses</th>
              <th className="px-3 py-2 text-right font-bold">Total</th>
              <th className="px-3 py-2">To next tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={SUBTOTAL_BUCKETS.length + 9}
                  className="px-3 py-6 text-center text-gray-500 dark:text-gray-400"
                >
                  No commission activity in {periodLabel(period)}.
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.techId ?? r.synergyId ?? r.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-gray-400 dark:text-gray-500 mr-1.5">{r.synergyId}</span>
                  {r.name}
                  {!r.commissionEligible && (
                    <span className="ml-2 rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      not commissioned
                    </span>
                  )}
                </td>
                {SUBTOTAL_BUCKETS.map((b) => (
                  <td key={b} className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {r.labor[b] === 0 ? '—' : formatMoney(r.labor[b])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                  {r.aceLabor === 0 ? '—' : formatMoney(r.aceLabor)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatMoney(r.subtotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.commissionEligible ? (
                    <>
                      {formatRate(r.rate)}
                      {r.rateIsOverride && (
                        <span
                          className="ml-1 text-xs text-amber-600 dark:text-amber-400"
                          title="Per-tech rate override, not the tier table"
                        >
                          ovr
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className="text-gray-400 dark:text-gray-500"
                      title="Not commissioned. Labor is recorded but pays nothing. Change this in Settings → Rates & Billing → Commission."
                    >
                      0%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.commission)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                  {r.pmBonus + r.equipmentBonus === 0
                    ? '—'
                    : formatMoney(r.pmBonus + r.equipmentBonus)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatMoney(r.total)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  {r.nextTier ? (
                    <span className="text-gray-600 dark:text-gray-400">
                      {formatMoney(r.nextTier.amountAway)} to {formatRate(r.nextTier.nextRate)}
                      <span className="ml-1 font-medium text-green-700 dark:text-green-400">
                        +{formatMoney(r.nextTier.gain)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800/60 font-semibold">
              <tr>
                <td className="px-3 py-2">Totals</td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  colSpan={SUBTOTAL_BUCKETS.length + 1}
                />
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(report.totals.subtotal)}
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(report.totals.commission)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(report.totals.bonuses)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(report.totals.total)}
                </td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollableTable>

      {/* Payout activity belonging to someone who is not on the tech roster.
          Real in prod: a manager has carried an approved ACE entry since May
          2026 that no report has ever shown. Kept out of the table above so the
          payout list stays a payout list, but never dropped. */}
      {report.offRosterRows.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Off-roster activity
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            ACE labor or lead bonuses recorded against someone who is not a technician. Worth a
            look: either the entry belongs to a tech and was filed against the wrong person, or
            the user should not have been able to submit it.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {report.offRosterRows.map((r) => (
              <li key={r.techId ?? r.name} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{r.role ?? 'no role'}</span>
                <span className="tabular-nums text-gray-600 dark:text-gray-400">
                  {r.aceLabor !== 0 && `${formatMoney(r.aceLabor)} ACE labor`}
                  {r.aceLabor !== 0 && r.pmBonus + r.equipmentBonus !== 0 && ' · '}
                  {r.pmBonus + r.equipmentBonus !== 0 &&
                    `${formatMoney(r.pmBonus + r.equipmentBonus)} bonuses`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footnotes that stop someone reading a number the wrong way */}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p>
          The rate applies to the <strong>whole subtotal</strong>, so tier boundaries are
          cliffs: $7,499.99 pays $375.00 and $7,500.00 pays $562.50. &ldquo;To next
          tier&rdquo; shows the jump in total commission from crossing, not the rate on
          the extra dollars.
        </p>
        <p>
          PM labor is taken at a flat 85% (&ldquo;PM Profit Est.&rdquo; is a standing
          parts allowance, not actual parts). Bonuses are flat and added <em>after</em>{' '}
          the percentage. Labor is on an invoice-date basis from Synergy; ACE and bonuses
          are bucketed on approval and earn dates in Central time.
        </p>
        <p>
          Diagnostic fees are excluded: they are not a technician&rsquo;s number
          (ruled 2026-07-31). They are still synced, so the dollars reconcile against
          Synergy, but they never appear on a payout row.
        </p>
        <p>
          Techs marked <em>not commissioned</em> still have their labor recorded, at 0%, so
          this report ties line for line to the workbook. ACE labor is part of the
          commissioned subtotal, not a separate payment, so a non-commissioned tech earns
          nothing on it. Lead bonuses are flat and pay either way. Change who is commissioned
          in Settings &rarr; Rates &amp; Billing &rarr; Commission.
        </p>
        {report.nonTechLabor !== 0 && (
          <p>
            {formatMoney(report.nonTechLabor)} of service labor this period was invoiced
            under an outside sales rep or an internal account rather than a technician,
            so it is not on anyone&rsquo;s payout. Expected, and noted only so this
            report and Synergy can always be reconciled to each other.
          </p>
        )}
        <p className="italic">
          Read-only. Figures recompute from current data on every load and no period is
          locked yet, so a late invoice or a reopened ticket can still move them.
        </p>
      </div>
    </div>
  )
}
