import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { buildProductCostMap } from '@/lib/db/products'
import { suggestExpectedCredit } from '@/lib/service-tickets/warranty'
import { deriveCustomerBillAmount } from '@/lib/service-tickets/warranty-server'
import type { ServiceTicketUpdate, ServicePartUsed } from '@/types/service-tickets'

// Records the vendor-credit lifecycle of a warranty claim from the warranty-claims
// worklist. A warranty/partial-warranty repair isn't billed until the vendor
// credit that offsets covered parts is received; this is how the office logs the
// claim being filed and the credit coming back. Manager/coordinator only — a
// front-desk/finance action, not a tech one. Mirrors resolve-decline.
//
// Body: { action: 'suggest' | 'file' | 'credit' | 'edit' | 'reset', vendor?,
//         claim_number?, credit_expected?, vendor_labor_rate?, labor_credit_amount?,
//         part_credits? }
//   suggest — read-only: the auto-suggested expected vendor credit + per-line
//             cost breakdown, used to prefill file-claim and power the reconcile
//             modal's expected column
//   file    — stamp the claim filed (submitted_at + who), set vendor/claim#/
//             expected/vendor_labor_rate
//   credit  — line-level reconcile: record what the vendor actually credited,
//             per covered part + labor, and stamp the credit received
//   edit    — update vendor/claim#/expected/amount without moving the lifecycle clocks
//   reset   — clear the credit-received stamp (correct a mistaken entry)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body?.action as string | undefined
    if (!['suggest', 'file', 'credit', 'edit', 'reset'].includes(action ?? '')) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    // Numeric guards — credit amounts must be finite, non-negative when present.
    const num = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const creditExpected = num(body?.credit_expected)
    const creditAmount = num(body?.credit_amount)
    if (Number.isNaN(creditExpected) || (typeof creditExpected === 'number' && creditExpected < 0)) {
      return NextResponse.json({ error: 'credit_expected must be a non-negative number' }, { status: 400 })
    }
    if (Number.isNaN(creditAmount) || (typeof creditAmount === 'number' && creditAmount < 0)) {
      return NextResponse.json({ error: 'credit_amount must be a non-negative number' }, { status: 400 })
    }
    const vendorLaborRate = num(body?.vendor_labor_rate)
    if (Number.isNaN(vendorLaborRate) || (typeof vendorLaborRate === 'number' && vendorLaborRate < 0)) {
      return NextResponse.json({ error: 'vendor_labor_rate must be a non-negative number' }, { status: 400 })
    }

    const supabase = await createClient()

    // Guard to a ticket with a verified warranty review. Every action below
    // needs this, including suggest (nothing to suggest for an unverified
    // ticket) — so it's checked once here against a superset select that
    // covers what suggest/credit need too.
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select(
        'id, status, warranty_review_status, deleted_at, hours_worked, warranty_labor_covered, warranty_vendor_labor_rate, warranty_labor_credit_amount, parts_used, shipping_charge, diagnostic_charge, diagnostic_invoice_number, billing_amount, warranty_claim_submitted_at'
      )
      .eq('id', id)
      .single()
    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    if (current.deleted_at) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    if (current.warranty_review_status !== 'verified') {
      return NextResponse.json({ error: 'This ticket has no verified warranty review.' }, { status: 400 })
    }

    const parts = (current.parts_used as ServicePartUsed[] | null) ?? []

    // --- suggest: read-only, no write. Powers file-claim prefill + the
    // reconcile modal's expected column. ---
    if (action === 'suggest') {
      const costMap = await buildProductCostMap(supabase, parts.map((p) => p.synergy_product_id))
      const costOf = (p: ServicePartUsed): number | null =>
        p.synergy_product_id != null ? costMap.get(p.synergy_product_id) ?? null : null

      const hoursWorked = Number(current.hours_worked) || 0
      const laborCovered = !!current.warranty_labor_covered
      const laborRate = current.warranty_vendor_labor_rate == null ? null : Number(current.warranty_vendor_labor_rate)

      const result = suggestExpectedCredit({
        hoursWorked,
        laborCovered,
        vendorLaborRate: laborRate,
        parts: parts.map((p) => ({
          qty: Number(p.quantity) || 0,
          covered: !!p.warranty_covered,
          unitCost: costOf(p),
        })),
      })

      const lines = parts.map((p, index) => ({
        index,
        description: p.description,
        qty: Number(p.quantity) || 0,
        covered: !!p.warranty_covered,
        unitCost: costOf(p),
      }))

      return NextResponse.json({
        amount: result.amount,
        unknownCostParts: result.unknownCostParts,
        lines,
        hoursWorked,
        vendorLaborRate: laborRate,
        laborCovered,
      })
    }

    const now = new Date().toISOString()
    const trim = (v: unknown): string | null | undefined =>
      v === undefined ? undefined : (typeof v === 'string' && v.trim() ? v.trim() : null)

    const update: ServiceTicketUpdate = {}

    // Common editable details (apply on file/edit/credit when provided).
    const vendor = trim(body?.vendor)
    const claimNumber = trim(body?.claim_number)
    if (vendor !== undefined) update.warranty_vendor = vendor
    if (claimNumber !== undefined) update.warranty_claim_number = claimNumber
    if (creditExpected !== undefined) update.warranty_credit_expected = creditExpected
    if (action !== 'credit' && creditAmount !== undefined) update.warranty_credit_amount = creditAmount

    if (action === 'file') {
      update.warranty_claim_submitted_at = now
      update.warranty_claim_submitted_by_id = user.id
      if (vendorLaborRate !== undefined) update.warranty_vendor_labor_rate = vendorLaborRate
    } else if (action === 'reset') {
      update.warranty_credit_received_at = null
      update.warranty_credit_received_by_id = null
      update.warranty_credit_amount = null
      update.warranty_labor_credit_amount = null
      update.parts_used = parts.map((p) =>
        p.vendor_credit_amount == null ? p : { ...p, vendor_credit_amount: null }
      )
      // Coverage itself is unchanged by a reset — customer_bill_amount stays.
    }

    // --- credit: line-level reconcile. Records what the vendor actually
    // credited, per covered part + labor, in one write. ---
    if (action === 'credit') {
      if (current.status !== 'completed' && current.status !== 'billed') {
        return NextResponse.json(
          { error: 'Credit can only be reconciled on a completed ticket.' },
          { status: 400 }
        )
      }

      const laborCreditAmount = num(body?.labor_credit_amount)
      if (
        Number.isNaN(laborCreditAmount) ||
        (typeof laborCreditAmount === 'number' && laborCreditAmount < 0)
      ) {
        return NextResponse.json(
          { error: 'labor_credit_amount must be a non-negative number' },
          { status: 400 }
        )
      }

      const partCreditsRaw = body?.part_credits
      const partCreditsByIndex = new Map<number, number>()
      if (partCreditsRaw !== undefined) {
        if (typeof partCreditsRaw !== 'object' || partCreditsRaw === null || Array.isArray(partCreditsRaw)) {
          return NextResponse.json({ error: 'part_credits must be an object' }, { status: 400 })
        }
        for (const [key, value] of Object.entries(partCreditsRaw as Record<string, unknown>)) {
          const idx = Number(key)
          if (!Number.isInteger(idx) || idx < 0 || idx >= parts.length) {
            return NextResponse.json(
              { error: `part_credits has an invalid or out-of-range index: ${key}` },
              { status: 400 }
            )
          }
          if (!parts[idx].warranty_covered) {
            return NextResponse.json(
              { error: `part_credits index ${idx} is not a covered part` },
              { status: 400 }
            )
          }
          const n = Number(value)
          if (!Number.isFinite(n) || n < 0) {
            return NextResponse.json(
              { error: `part_credits[${key}] must be a non-negative number` },
              { status: 400 }
            )
          }
          partCreditsByIndex.set(idx, n)
        }
      }

      // Untouched indexes keep their existing vendor_credit_amount.
      const nextParts = parts.map((p, i) =>
        partCreditsByIndex.has(i) ? { ...p, vendor_credit_amount: partCreditsByIndex.get(i)! } : p
      )
      const partsCreditSum = nextParts.reduce((sum, p) => sum + (Number(p.vendor_credit_amount) || 0), 0)

      const laborCreditProvided = laborCreditAmount !== undefined
      const effectiveLaborCredit = laborCreditProvided
        ? laborCreditAmount ?? 0
        : Number(current.warranty_labor_credit_amount) || 0

      update.parts_used = nextParts
      if (laborCreditProvided) update.warranty_labor_credit_amount = laborCreditAmount
      update.warranty_credit_amount = Math.round((effectiveLaborCredit + partsCreditSum) * 100) / 100

      // Coverage-driven, unchanged by credits — re-derived for freshness so a
      // stale value never sits alongside a fresh reconcile.
      update.customer_bill_amount = deriveCustomerBillAmount({
        billing_amount: current.billing_amount as number | null,
        shipping_charge: current.shipping_charge as number | null,
        diagnostic_charge: current.diagnostic_charge as number | null,
        diagnostic_invoice_number: current.diagnostic_invoice_number as string | null,
        warranty_labor_covered: current.warranty_labor_covered as boolean | null,
        parts_used: nextParts,
      })

      update.warranty_credit_received_at = now
      update.warranty_credit_received_by_id = user.id
      // Filing is implied when the credit comes back without a logged filing
      // (covers logging a credit on a claim filed offline).
      if (!current.warranty_claim_submitted_at) {
        update.warranty_claim_submitted_at = now
        update.warranty_claim_submitted_by_id = user.id
      }
    }

    const { error } = await supabase
      .from('service_tickets')
      .update(update)
      .eq('id', id)

    if (error) {
      console.error('warranty-claim: update failed', error)
      return NextResponse.json({ error: 'Failed to update the warranty claim' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('service-tickets/[id]/warranty-claim POST error:', err)
    return NextResponse.json({ error: 'Failed to update the warranty claim' }, { status: 500 })
  }
}
