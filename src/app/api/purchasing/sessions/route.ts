import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { listSessions, createSession } from '@/lib/db/reorder'
import { suggestQty } from '@/lib/reorder/suggest'
import { binSortKey } from '@/lib/reorder/bin-sort'
import type {
  ReorderScopeType,
  ReorderLineInsert,
  ReorderSessionVendorInsert,
  InvReorderRow,
} from '@/types/reorder'

const SCOPE_TYPES: ReorderScopeType[] = ['all', 'zone', 'vendor', 'below_rop']

// PostgREST's default per-request row ceiling — the active/not-DNR Whse-4
// universe is ~1,242 rows, so this walk-universe read must paginate past it
// (mirrors getSessionLines) or the tail of a full "all" scope silently vanishes.
const PAGE_SIZE = 1000

// Reads the in-scope inv_reorder universe for a session, ALWAYS restricted to
// active=true AND do_not_reorder=false. zone/vendor are expressed directly in
// the PostgREST query; below_rop needs a column-to-column comparison
// (order_point > 0 AND qty_available <= order_point) that PostgREST can't do,
// so that filter is applied in JS after the full paginated read.
async function fetchInScopeInvReorder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scopeType: ReorderScopeType,
  vendorCode: number | null,
  zonePrefix: string | null
): Promise<InvReorderRow[]> {
  const rows: InvReorderRow[] = []
  let offset = 0

  for (;;) {
    let query = supabase
      .from('inv_reorder')
      .select('*')
      .eq('active', true)
      .eq('do_not_reorder', false)

    if (scopeType === 'vendor' && vendorCode != null) {
      query = query.eq('vendor_code', vendorCode)
    } else if (scopeType === 'zone' && zonePrefix) {
      query = query.ilike('primary_bin', `${zonePrefix}%`)
    }

    query = query
      .order('synergy_product_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    const { data, error } = await query
    if (error) throw error

    const page = (data ?? []) as InvReorderRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (scopeType === 'below_rop') {
    return rows.filter(
      (r) => (r.order_point ?? 0) > 0 && (r.qty_available ?? 0) <= (r.order_point ?? 0)
    )
  }

  return rows
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name, scope_type, scope_value } = body as {
      name?: string
      scope_type?: string
      scope_value?: string | number
    }

    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!scope_type || !SCOPE_TYPES.includes(scope_type as ReorderScopeType)) {
      return NextResponse.json(
        { error: 'scope_type must be one of all, zone, vendor, below_rop' },
        { status: 400 }
      )
    }
    const scopeType = scope_type as ReorderScopeType

    let vendorCode: number | null = null
    let zonePrefix: string | null = null

    if (scopeType === 'vendor') {
      const parsed = parseInt(String(scope_value ?? ''), 10)
      if (!Number.isFinite(parsed)) {
        return NextResponse.json(
          { error: 'scope_value must be a numeric vendor_code for scope_type vendor' },
          { status: 400 }
        )
      }
      vendorCode = parsed
    }

    if (scopeType === 'zone') {
      const trimmed = String(scope_value ?? '').trim()
      // Alphanumeric only — this feeds an ILIKE pattern below, so reject
      // wildcard/control characters rather than passing them through.
      if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
        return NextResponse.json(
          { error: 'scope_value must be an alphanumeric bin/zone prefix for scope_type zone' },
          { status: 400 }
        )
      }
      zonePrefix = trimmed
    }

    const supabase = await createClient()

    const inScope = await fetchInScopeInvReorder(supabase, scopeType, vendorCode, zonePrefix)

    if (inScope.length === 0) {
      return NextResponse.json({ error: 'No in-scope items found for this scope' }, { status: 422 })
    }

    // Resolve vendor names for the in-scope vendor set in ONE batch query —
    // never N+1 per line.
    const vendorCodes = Array.from(
      new Set(inScope.map((r) => r.vendor_code).filter((v): v is number => v != null))
    )
    const vendorNameByCode = new Map<number, string | null>()
    if (vendorCodes.length > 0) {
      const { data: vendorRows, error: vendorErr } = await supabase
        .from('inv_vendors')
        .select('vendor_code, name')
        .in('vendor_code', vendorCodes)
      if (vendorErr) throw vendorErr
      for (const v of vendorRows ?? []) {
        vendorNameByCode.set(v.vendor_code, v.name)
      }
    }

    const inventoryAsOf = inScope.reduce<string | null>((max, r) => {
      if (!r.synced_at) return max
      return !max || r.synced_at > max ? r.synced_at : max
    }, null)

    const session = await createSession({
      name: name.trim(),
      status: 'draft',
      scope_type: scopeType,
      scope_value: scopeType === 'vendor' || scopeType === 'zone' ? String(scope_value) : null,
      created_by_id: user.id,
      inventory_as_of: inventoryAsOf,
      total_items: inScope.length,
      lines_ordered: 0,
      est_total_cost: 0,
    })

    const lineInserts: ReorderLineInsert[] = inScope.map((row) => {
      const result = suggestQty({
        qtyOnHand: row.qty_on_hand ?? 0,
        qtyOnPo: row.qty_on_po ?? 0,
        qtyCommitted: row.qty_committed ?? 0,
        orderPoint: row.order_point ?? 0,
        maxStock: row.max_stock ?? 0,
        safetyStock: row.safety_stock ?? 0,
        doNotReorder: row.do_not_reorder,
        packQty: row.pack_qty ?? 1,
        periodUsage: row.period_usage ?? [],
        usageRate: row.usage_rate,
        demand: row.demand,
      })

      return {
        session_id: session.id,
        synergy_product_id: row.synergy_product_id,
        description: row.description,
        vendor_code: row.vendor_code,
        vendor_name: row.vendor_code != null ? vendorNameByCode.get(row.vendor_code) ?? null : null,
        vendor_item_number: row.vendor_item_number,
        bin_location: row.primary_bin,
        buying_uom: row.buying_uom,
        pack_qty: row.pack_qty,
        qoh: row.qty_on_hand,
        on_order: row.qty_on_po,
        committed: row.qty_committed,
        available: row.qty_available,
        weekly_usage: result.weeklyUsage,
        weeks_of_supply: Number.isFinite(result.weeksOfSupply) ? result.weeksOfSupply : null,
        order_point: row.order_point,
        max_level: row.max_stock,
        suggested_qty: result.suggestedCases,
        unit_cost: row.unit_cost,
        order_qty: 0,
        line_status: 'pending',
        sort_key: row.bin_sort_key ?? binSortKey(row.primary_bin),
      }
    })

    // Batch-insert in chunks of <=500 (mirrors the sync's BATCH_SIZE pattern) —
    // never one giant insert for a ~1,242-line walk.
    const BATCH_SIZE = 500
    for (let i = 0; i < lineInserts.length; i += BATCH_SIZE) {
      const batch = lineInserts.slice(i, i + BATCH_SIZE)
      const { error: insertErr } = await supabase.from('reorder_lines').insert(batch)
      if (insertErr) {
        console.error('purchasing/sessions POST: line insert failed', insertErr)
        return NextResponse.json({ error: 'Failed to create reorder lines' }, { status: 500 })
      }
    }

    // Seed one reorder_session_vendors row per distinct vendor represented in
    // the walk. line_count/subtotal consistently mean "ordered-only" across the
    // module (that's what recomputeSessionRollups maintains and what the review
    // page + worksheet consume), so both start at 0 — nothing is ordered at
    // creation time.
    const vendorSeed = new Map<number, string | null>()
    for (const line of lineInserts) {
      if (line.vendor_code == null) continue
      if (!vendorSeed.has(line.vendor_code)) {
        vendorSeed.set(line.vendor_code, line.vendor_name ?? null)
      }
    }

    if (vendorSeed.size > 0) {
      const vendorInserts: ReorderSessionVendorInsert[] = Array.from(vendorSeed.entries()).map(
        ([vendor_code, vendor_name]) => ({
          session_id: session.id,
          vendor_code,
          vendor_name,
          line_count: 0,
          subtotal: 0,
        })
      )
      const { error: vendorInsertErr } = await supabase
        .from('reorder_session_vendors')
        .insert(vendorInserts)
      if (vendorInsertErr) {
        console.error('purchasing/sessions POST: vendor seed insert failed', vendorInsertErr)
        return NextResponse.json({ error: 'Failed to seed session vendors' }, { status: 500 })
      }
    }

    return NextResponse.json(session, { status: 201 })
  } catch (err) {
    console.error('purchasing/sessions POST error:', err)
    return NextResponse.json({ error: 'Failed to create reorder session' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sessions = await listSessions()
    return NextResponse.json(sessions)
  } catch (err) {
    console.error('purchasing/sessions GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch reorder sessions' }, { status: 500 })
  }
}
