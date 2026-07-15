// @react-pdf/renderer requires Node.js runtime (uses fs / canvas internals).
// Match billing/pdf and the other PDF-producing routes.
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { getSession, getSessionLines } from '@/lib/db/reorder'
import { getUser } from '@/lib/db/users'
import { getSetting } from '@/lib/db/settings'
import { APP_NAME } from '@/lib/branding'
import {
  ReorderWorksheetDocument,
  type WorksheetVendorGroup,
} from '@/lib/pdf/reorder-worksheet-template'
import type { InvVendorRow, ReorderLineRow } from '@/types/reorder'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// CSV helpers
// ============================================================

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csvRow(values: (string | number)[]): string {
  return values.map((v) => csvEscape(String(v))).join(',') + '\r\n'
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'reorder-walk'
}

// ============================================================
// POST /api/purchasing/sessions/[id]/worksheet
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { format, vendorCode } = body as { format?: string; vendorCode?: number }

    if (format !== 'pdf' && format !== 'csv') {
      return NextResponse.json({ error: "format must be 'pdf' or 'csv'" }, { status: 400 })
    }
    if (vendorCode !== undefined && (typeof vendorCode !== 'number' || !Number.isFinite(vendorCode))) {
      return NextResponse.json({ error: 'vendorCode must be a number' }, { status: 400 })
    }

    const session = await getSession(id)
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const allLines = await getSessionLines(id)
    // Only lines with an order qty AND an assigned vendor can go on a PO
    // worksheet (a vendor is the grouping key) — null-vendor lines are
    // excluded here, same as the review page's "No preferred vendor" bucket.
    let orderedLines = allLines.filter((l) => l.order_qty > 0 && l.vendor_code != null)

    if (vendorCode !== undefined) {
      orderedLines = orderedLines.filter((l) => l.vendor_code === vendorCode)
      if (orderedLines.length === 0) {
        return NextResponse.json({ error: 'No ordered lines for that vendor' }, { status: 404 })
      }
    }

    if (orderedLines.length === 0) {
      return NextResponse.json(
        { error: 'No ordered lines with an assigned vendor to export' },
        { status: 400 }
      )
    }

    const vendorCodes = Array.from(new Set(orderedLines.map((l) => l.vendor_code as number)))

    const supabase = await createClient()
    const { data: vendorMasterRows, error: vendorError } = await supabase
      .from('inv_vendors')
      .select('*')
      .in('vendor_code', vendorCodes)
    if (vendorError) throw vendorError
    const masterMap = new Map<number, InvVendorRow>(
      ((vendorMasterRows ?? []) as InvVendorRow[]).map((v) => [v.vendor_code, v])
    )

    const byVendor = new Map<number, ReorderLineRow[]>()
    for (const line of orderedLines) {
      const code = line.vendor_code as number
      const arr = byVendor.get(code) ?? []
      arr.push(line)
      byVendor.set(code, arr)
    }

    const vendorGroups: WorksheetVendorGroup[] = Array.from(byVendor.entries()).map(([code, groupLines]) => {
      const master = masterMap.get(code) ?? null
      const sortedLines = [...groupLines].sort((a, b) =>
        (a.bin_location ?? '').localeCompare(b.bin_location ?? '')
      )
      const subtotal = groupLines.reduce(
        (sum, l) => sum + l.order_qty * (l.pack_qty ?? 1) * (l.unit_cost ?? 0),
        0
      )
      return {
        vendorCode: code,
        vendorName: groupLines[0].vendor_name ?? master?.name ?? `Vendor ${code}`,
        orderMinimum: master?.order_minimum ?? null,
        lineCount: groupLines.length,
        subtotal,
        lines: sortedLines.map((l) => ({
          productNumber: l.synergy_product_id,
          description: l.description,
          orderQty: l.order_qty,
          buyingUom: l.buying_uom,
          vendorItemNumber: l.vendor_item_number,
          unitCost: l.unit_cost,
          caseCost: (l.pack_qty ?? 1) * (l.unit_cost ?? 0),
          extended: l.order_qty * (l.pack_qty ?? 1) * (l.unit_cost ?? 0),
          binLocation: l.bin_location,
          note: l.flag_note,
        })),
      }
    })
    vendorGroups.sort((a, b) => a.vendorName.localeCompare(b.vendorName))

    const buyer = session.created_by_id ? await getUser(session.created_by_id) : null
    const buyerName = buyer?.name ?? null

    const exportedAt = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const sessionSlug = slugify(session.name)
    const vendorSuffix = vendorCode !== undefined ? `-vendor${vendorCode}` : ''

    if (format === 'csv') {
      const header = [
        'Vendor Code',
        'Vendor Name',
        'Product #',
        'Description',
        'Order Qty (cases)',
        'Buying UOM',
        'Vendor Item #',
        'Unit Cost (ea)',
        'Case Cost',
        'Extended',
        'Bin',
        'Note',
      ]
      let csv = csvRow(header)
      for (const group of vendorGroups) {
        for (const line of group.lines) {
          csv += csvRow([
            group.vendorCode,
            group.vendorName,
            line.productNumber,
            line.description ?? '',
            line.orderQty,
            line.buyingUom ?? '',
            line.vendorItemNumber ?? '',
            line.unitCost != null ? line.unitCost.toFixed(4) : '',
            line.caseCost.toFixed(2),
            line.extended.toFixed(2),
            line.binLocation ?? '',
            line.note ?? '',
          ])
        }
      }
      const filename = `Reorder-Worksheet-${sessionSlug}${vendorSuffix}.csv`
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    // --- PDF ---
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      const logoBuffer = fs.readFileSync(logoPath)
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`
    } catch {
      // Logo not found — render without it.
    }
    const companyName = await getSetting('company_name')

    const element = React.createElement(ReorderWorksheetDocument, {
      vendors: vendorGroups,
      buyerName,
      exportedAt,
      companyName: companyName || APP_NAME,
      logoBase64,
    } as Parameters<typeof ReorderWorksheetDocument>[0])

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('purchasing/sessions/[id]/worksheet POST renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render worksheet PDF' }, { status: 500 })
    }

    const filename = `Reorder-Worksheet-${sessionSlug}${vendorSuffix}.pdf`
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('purchasing/sessions/[id]/worksheet POST error:', err)
    return NextResponse.json({ error: 'Failed to generate worksheet' }, { status: 500 })
  }
}
