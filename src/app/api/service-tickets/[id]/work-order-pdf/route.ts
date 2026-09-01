export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { ServiceWorkOrderDocument } from '@/lib/pdf/service-work-order-template'
import {
  buildServiceWorkOrder,
  SERVICE_WORK_ORDER_SELECT,
  type ServiceWorkOrderRow,
} from '@/lib/pdf/service-work-order-data'
import { createClient } from '@/lib/supabase/server'
import { resolveServiceLaborRate } from '@/lib/pdf/service-work-order-rate'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getSetting } from '@/lib/db/settings'
import * as fs from 'fs'
import * as path from 'path'

// Customer-facing completion document for a service ticket — parity with the PM
// /api/tickets/[id]/work-order-pdf route.
//
// The row -> document mapping, including the warranty pricing-mode rules, lives
// in @/lib/pdf/service-work-order-data so this route and the batch billing
// export (/api/billing/service/export-pdf) cannot drift apart.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Office-only preview toggle; a technician generating their own copy
    // never sends this. Body is optional (the export flow POSTs with none).
    const body = await request.json().catch(() => ({} as { pricing?: string }))
    const requestedNet = body?.pricing === 'net'

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    const { data: raw, error: fetchError } = await supabase
      .from('service_tickets')
      .select(SERVICE_WORK_ORDER_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (fetchError || !raw) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Must be completed or billed (mirrors the PM work order gate).
    if (raw.status !== 'completed' && raw.status !== 'billed') {
      return NextResponse.json(
        { error: 'Ticket must be completed to generate a work order' },
        { status: 400 }
      )
    }

    // Techs can only generate for their own tickets.
    if (isTechnician(user.role) && raw.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // The select is a shared constant, so supabase-js can't infer the row shape;
    // ServiceWorkOrderRow is that shape, declared alongside the select it matches.
    const row = raw as unknown as ServiceWorkOrderRow

    // Signed URLs for completion photos (short-lived; PDF embeds them at render).
    const photoUrls: string[] = []
    for (const photo of row.photos ?? []) {
      try {
        const { data } = await supabase.storage
          .from('ticket-photos')
          .createSignedUrl(photo.storage_path, 120)
        if (data?.signedUrl) photoUrls.push(data.signedUrl)
      } catch {
        // Skip failed photos
      }
    }

    const laborRate = await resolveServiceLaborRate(row)

    // Load logo
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    } catch {
      // render without logo
    }

    const companyName = (await getSetting('company_name')) || undefined

    // Row → document data, including every warranty pricing rule, lives in
    // service-work-order-data.ts so the batch export at
    // /api/billing/service/export-pdf renders a byte-identical work order.
    const workOrder = buildServiceWorkOrder(row, {
      laborRate,
      photoUrls,
      requestedNet,
    })

    const element = React.createElement(ServiceWorkOrderDocument, {
      workOrder,
      logoBase64,
      companyName,
    })

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('[service work-order-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const customerSlug = (row.customers?.name ?? 'Customer').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const woLabel = row.work_order_number ? `WO-${row.work_order_number}` : 'WorkOrder'
    const filename = `${woLabel}-${customerSlug}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[service work-order-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
