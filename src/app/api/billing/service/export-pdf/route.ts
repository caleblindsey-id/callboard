// @react-pdf/renderer requires Node.js runtime (uses fs / canvas internals).
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { ServiceWorkOrderPage } from '@/lib/pdf/service-work-order-template'
import {
  buildServiceWorkOrder,
  SERVICE_WORK_ORDER_SELECT,
  type ServiceWorkOrderRow,
} from '@/lib/pdf/service-work-order-data'
import { resolveServiceLaborRate } from '@/lib/pdf/service-work-order-rate'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { getSetting } from '@/lib/db/settings'
import { MANAGER_ROLES } from '@/types/database'
import * as fs from 'fs'
import * as path from 'path'

// Batch export for the Service "Ready to Export" queue — the counterpart to the
// PM /api/billing/pdf route (feedback #95: the Service list was the only one on
// /billing with no bulk select, so clearing 30 tickets meant 30 clicks and 30
// downloads).
//
// Why one combined PDF rather than N files: browsers block multi-file
// programmatic downloads, which is exactly why this list was per-row to begin
// with. So the work orders are composed into a single <Document>, one page per
// ticket, in the order the client sent them.
//
// Each page is built by the SAME buildServiceWorkOrder used by the per-ticket
// route, so every field on a work order — every dollar amount above all — is the
// same whether it was exported on its own or inside a batch. The one intended
// difference is the footer: @react-pdf scopes "Page X of Y" to the Document, so
// here it numbers the whole batch (page 3 of 7), not each work order. That reads
// correctly for what this PDF is — one stack the coordinator pages through while
// keying Synergy. A customer-facing single copy still comes from the per-ticket
// route and still says "Page 1 of 1".
//
// Ordering matches /api/billing/pdf: render FIRST, then compare-and-swap the
// billing_exported flag. A render failure therefore leaves every ticket in
// Ready to Export, so the retry is idempotent — the opposite order would strand
// tickets in Awaiting Invoice # with no PDF to key from.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const ticketIds = (body as { ticketIds?: unknown }).ticketIds
    if (
      !Array.isArray(ticketIds) ||
      ticketIds.length === 0 ||
      !ticketIds.every((id) => typeof id === 'string')
    ) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    const ids = ticketIds as string[]
    // A duplicated id would render the same work order twice and inflate the
    // count in the success toast.
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length !== ids.length) {
      return NextResponse.json({ error: 'ticketIds contains duplicates' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !dbUser.role || !MANAGER_ROLES.includes(dbUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: rawTickets, error: fetchError } = await supabase
      .from('service_tickets')
      .select(SERVICE_WORK_ORDER_SELECT)
      .in('id', uniqueIds)
      .eq('status', 'completed')
      .eq('billing_exported', false)
      .is('deleted_at', null)

    if (fetchError) {
      console.error('[billing/service/export-pdf] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
    }

    // Strict count check (mirrors /api/billing/pdf and the sibling export
    // route): a batch containing a deleted, reopened, or already-exported id
    // fails whole rather than silently rendering a partial PDF for the subset
    // that happened to match. The board this comes from already filters to
    // completed + unexported + non-deleted, so a mismatch means a stale tab.
    if (!rawTickets || rawTickets.length !== uniqueIds.length) {
      return NextResponse.json(
        {
          error:
            'One or more tickets are no longer ready to export (already exported, reopened, or deleted). Refresh to see the updated list.',
        },
        { status: 409 }
      )
    }

    const rows = rawTickets as unknown as ServiceWorkOrderRow[]
    // Render in the order the client selected them, not Postgres' return order,
    // so the printed stack matches the on-screen list.
    const byId = new Map(rows.map((r) => [r.id, r]))
    const orderedRows = uniqueIds.map((id) => byId.get(id)!)

    // Signed URLs for completion photos, batched per ticket and resolved in
    // parallel. 600s TTL (not the per-ticket route's 120s) because a batch
    // render is slower than a single one and an expired URL renders a blank.
    const photoUrlsById = new Map<string, string[]>()
    await Promise.all(
      orderedRows.map(async (row) => {
        const paths = (row.photos ?? []).map((p) => p.storage_path).filter(Boolean)
        if (paths.length === 0) {
          photoUrlsById.set(row.id, [])
          return
        }
        try {
          const { data } = await supabase.storage
            .from('ticket-photos')
            .createSignedUrls(paths, 600)
          photoUrlsById.set(
            row.id,
            (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u)
          )
        } catch {
          photoUrlsById.set(row.id, [])
        }
      })
    )

    // One query per distinct rate lookup would serialize; resolve in parallel.
    const laborRates = await Promise.all(orderedRows.map((row) => resolveServiceLaborRate(row)))

    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    } catch {
      // render without logo
    }

    const companyName = (await getSetting('company_name')) || undefined

    // The batch is the coordinator's own keying artifact, never a warranty
    // preview, so requestedNet is always false here — a ticket still renders
    // net on its own merits (legacy warranty row, or verified + credited).
    const pages = orderedRows.map((row, i) =>
      React.createElement(ServiceWorkOrderPage, {
        key: row.id,
        workOrder: buildServiceWorkOrder(row, {
          laborRate: laborRates[i],
          photoUrls: photoUrlsById.get(row.id) ?? [],
        }),
        logoBase64,
        companyName,
      })
    )

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = React.createElement(Document, null, ...pages) as React.ReactElement<any>
      buffer = await renderToBuffer(element)
    } catch (renderErr) {
      console.error('[billing/service/export-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    // CAS: only flip rows still completed + un-exported + not deleted. The
    // fetch's filters do NOT protect this write — it runs after an async render
    // and signed-URL round trips, so a ticket reopened or deleted in between
    // must not be marked exported. A concurrent duplicate matches zero rows and
    // gets a 409 so the client refreshes instead of silently double-exporting.
    const { data: marked, error: updateError } = await supabase
      .from('service_tickets')
      .update({ billing_exported: true, billing_exported_at: new Date().toISOString() })
      .in('id', uniqueIds)
      .is('deleted_at', null)
      .eq('status', 'completed')
      .eq('billing_exported', false)
      .select('id')

    if (updateError) {
      console.error('[billing/service/export-pdf] update error:', updateError)
      return NextResponse.json(
        { error: 'PDF rendered but tickets could not be marked exported. Please refresh and try again.' },
        { status: 500 }
      )
    }
    if (!marked || marked.length === 0) {
      return NextResponse.json(
        { error: 'These tickets were already exported in another tab/session. Refresh to see the updated list.' },
        { status: 409 }
      )
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const filename =
      orderedRows.length === 1 && orderedRows[0].work_order_number
        ? `WO-${orderedRows[0].work_order_number}.pdf`
        : `Service-Work-Orders-${orderedRows.length}-${stamp}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // The client shows "N exported" from this, since a PDF body carries no
        // JSON to read it from.
        'X-Exported-Count': String(marked.length),
      },
    })
  } catch (err) {
    console.error('[billing/service/export-pdf] unexpected:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
