import { createClient } from '@/lib/supabase/server'
import { skipReasonLabel, isStopReason } from '@/lib/skip-reasons'

// Service-operations report aggregates (audit feature #1, "reporting depth").
// Every number here was already captured ticket-by-ticket — estimate outcomes
// (migrations 114/117/118), warranty credits (119), margin overrides, PM skip
// categories (080) — but never aggregated anywhere. One read-only rollup,
// manager-gated by the page. Mirrors getSupplyRequestReport's shape: a single
// function taking a lookback window in days (null = all time).

export type ServiceOpsReport = {
  rangeDays: number | null
  estimates: {
    sent: number
    approved: number
    declined: number
    // Win rate over DECIDED estimates in the window: approved / (approved + declined).
    winRatePct: number | null
    // Point-in-time: tickets sitting at 'estimated' right now, regardless of window.
    awaitingDecision: number
    avgDeclinedAmount: number | null
    declineReasons: { reason: string; count: number }[]
  }
  warranty: {
    filed: number
    received: number
    receivedAmount: number
    // Point-in-time: expected credit on claims filed but not yet credited.
    outstandingExpected: number
    medianDaysToCredit: number | null
  }
  marginOverrides: {
    count: number
    byUser: { name: string; count: number }[]
  }
  pmSkips: {
    total: number
    // Share of skips whose category means the unit is gone / service ending.
    stopSharePct: number | null
    byCategory: { category: string; label: string; count: number }[]
  }
}

function cutoffIso(rangeDays: number | null): string | null {
  if (rangeDays == null) return null
  return new Date(Date.now() - rangeDays * 86_400_000).toISOString()
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function getServiceOpsReport(rangeDays: number | null): Promise<ServiceOpsReport> {
  const supabase = await createClient()
  const cutoff = cutoffIso(rangeDays)

  // ── Estimates ──
  // Sent/approved counted on service_tickets by their stamps; declines counted
  // from equipment_estimate_log, the permanent per-decline snapshot (a reopened
  // ticket clears its live decline fields, so the log is the only stable count).
  const sentQ = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .not('estimated_at', 'is', null)
  const approvedQ = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .not('estimate_approved_at', 'is', null)
  const declinesQ = supabase
    .from('equipment_estimate_log')
    .select('estimate_amount, decline_reason, created_at')
    .eq('outcome', 'declined')
  const awaitingQ = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'estimated')
    .is('deleted_at', null)

  const [sentRes, approvedRes, declinesRes, awaitingRes] = await Promise.all([
    cutoff ? sentQ.gte('estimated_at', cutoff) : sentQ,
    cutoff ? approvedQ.gte('estimate_approved_at', cutoff) : approvedQ,
    cutoff ? declinesQ.gte('created_at', cutoff) : declinesQ,
    awaitingQ,
  ])
  if (sentRes.error) throw sentRes.error
  if (approvedRes.error) throw approvedRes.error
  if (declinesRes.error) throw declinesRes.error
  if (awaitingRes.error) throw awaitingRes.error

  const declineRows = (declinesRes.data ?? []) as {
    estimate_amount: number | null
    decline_reason: string | null
  }[]
  const approved = approvedRes.count ?? 0
  const declined = declineRows.length
  const decided = approved + declined

  const declinedAmounts = declineRows
    .map((r) => r.estimate_amount)
    .filter((v): v is number => typeof v === 'number')
  const reasonCounts = new Map<string, number>()
  for (const r of declineRows) {
    const reason = r.decline_reason?.trim()
    if (!reason) continue
    const key = reason.toLowerCase()
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
  }
  const declineReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }))

  // ── Warranty credits ──
  // Claims live on service_tickets (migration 119) and the fields persist after
  // billing, so historical rollups stay correct.
  const filedQ = supabase
    .from('service_tickets')
    .select('warranty_claim_submitted_at, warranty_credit_received_at, warranty_credit_amount', { count: 'exact' })
    .not('warranty_claim_submitted_at', 'is', null)
  const outstandingQ = supabase
    .from('service_tickets')
    .select('warranty_credit_expected')
    .not('warranty_claim_submitted_at', 'is', null)
    .is('warranty_credit_received_at', null)
    .is('deleted_at', null)

  const [filedRes, outstandingRes] = await Promise.all([
    cutoff ? filedQ.gte('warranty_claim_submitted_at', cutoff) : filedQ,
    outstandingQ,
  ])
  if (filedRes.error) throw filedRes.error
  if (outstandingRes.error) throw outstandingRes.error

  const filedRows = (filedRes.data ?? []) as {
    warranty_claim_submitted_at: string
    warranty_credit_received_at: string | null
    warranty_credit_amount: number | null
  }[]
  const receivedRows = filedRows.filter((r) => r.warranty_credit_received_at)
  const daysToCredit = receivedRows.map((r) =>
    Math.max(
      0,
      Math.round(
        (new Date(r.warranty_credit_received_at as string).getTime() -
          new Date(r.warranty_claim_submitted_at).getTime()) /
          86_400_000
      )
    )
  )
  const outstandingExpected = ((outstandingRes.data ?? []) as { warranty_credit_expected: number | null }[])
    .reduce((sum, r) => sum + (r.warranty_credit_expected ?? 0), 0)

  // ── Margin overrides ──
  const overridesQ = supabase
    .from('service_tickets')
    .select('margin_override_by, margin_override_at')
    .not('margin_override_at', 'is', null)
  const overridesRes = await (cutoff ? overridesQ.gte('margin_override_at', cutoff) : overridesQ)
  if (overridesRes.error) throw overridesRes.error
  const overrideRows = (overridesRes.data ?? []) as { margin_override_by: string | null }[]

  const overriderIds = [...new Set(overrideRows.map((r) => r.margin_override_by).filter((v): v is string => !!v))]
  const nameById = new Map<string, string>()
  if (overriderIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, name').in('id', overriderIds)
    for (const u of (users ?? []) as { id: string; name: string | null }[]) {
      nameById.set(u.id, u.name ?? 'Unknown')
    }
  }
  const overrideByUser = new Map<string, number>()
  for (const r of overrideRows) {
    const name = r.margin_override_by ? nameById.get(r.margin_override_by) ?? 'Unknown' : 'Unknown'
    overrideByUser.set(name, (overrideByUser.get(name) ?? 0) + 1)
  }

  // ── PM skips ──
  // Skipped PM tickets keep their scheduled month/year, which is the natural
  // bucket ("June's PMs"): compare against the window using the first of the
  // scheduled month rather than updated_at (which any later edit would move).
  const { data: skipData, error: skipErr } = await supabase
    .from('pm_tickets')
    .select('month, year, skip_reason_category')
    .eq('status', 'skipped')
    .is('deleted_at', null)
  if (skipErr) throw skipErr

  const cutoffMs = cutoff ? new Date(cutoff).getTime() : null
  const skipRows = ((skipData ?? []) as { month: number; year: number; skip_reason_category: string | null }[])
    .filter((r) => cutoffMs == null || new Date(r.year, r.month - 1, 1).getTime() >= cutoffMs)

  const skipByCategory = new Map<string, number>()
  for (const r of skipRows) {
    const cat = r.skip_reason_category ?? 'uncategorized'
    skipByCategory.set(cat, (skipByCategory.get(cat) ?? 0) + 1)
  }
  const stopSkips = skipRows.filter((r) => isStopReason(r.skip_reason_category)).length

  return {
    rangeDays,
    estimates: {
      sent: sentRes.count ?? 0,
      approved,
      declined,
      winRatePct: decided > 0 ? Math.round((approved / decided) * 100) : null,
      awaitingDecision: awaitingRes.count ?? 0,
      avgDeclinedAmount:
        declinedAmounts.length > 0
          ? declinedAmounts.reduce((a, b) => a + b, 0) / declinedAmounts.length
          : null,
      declineReasons,
    },
    warranty: {
      filed: filedRows.length,
      received: receivedRows.length,
      receivedAmount: receivedRows.reduce((sum, r) => sum + (r.warranty_credit_amount ?? 0), 0),
      outstandingExpected,
      medianDaysToCredit: median(daysToCredit),
    },
    marginOverrides: {
      count: overrideRows.length,
      byUser: [...overrideByUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    },
    pmSkips: {
      total: skipRows.length,
      stopSharePct: skipRows.length > 0 ? Math.round((stopSkips / skipRows.length) * 100) : null,
      byCategory: [...skipByCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({
          category,
          label: category === 'uncategorized' ? 'No category (legacy)' : skipReasonLabel(category),
          count,
        })),
    },
  }
}
