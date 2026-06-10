export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { EstimateDocument } from '@/lib/pdf/estimate-template'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import type { ServicePartUsed } from '@/types/service-tickets'
import * as fs from 'fs'
import * as path from 'path'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    // Fetch ticket with joins
    const { data: raw, error: fetchError } = await supabase
      .from('service_tickets')
      .select(`
        id,
        work_order_number,
        status,
        ticket_type,
        billing_type,
        problem_description,
        diagnosis_notes,
        estimate_amount,
        estimate_labor_hours,
        estimate_labor_rate,
        estimate_parts,
        contact_name,
        contact_email,
        contact_phone,
        service_address,
        service_city,
        service_state,
        service_zip,
        equipment_make,
        equipment_model,
        equipment_serial_number,
        assigned_technician_id,
        created_at,
        customers(name, account_number),
        equipment:equipment!service_tickets_equipment_id_fkey(
          make, model, serial_number,
          ship_to_locations(address, city, state, zip)
        ),
        assigned_technician:users!service_tickets_assigned_technician_id_fkey(name)
      `)
      .eq('id', id)
      .single()

    if (fetchError || !raw) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Must have an estimate
    if (raw.estimate_amount == null) {
      return NextResponse.json({ error: 'No estimate submitted for this ticket' }, { status: 400 })
    }

    // Techs can only generate for their own tickets
    if (isTechnician(user.role) && raw.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build service address
    const customer = raw.customers as { name: string; account_number: string | null } | null
    const equipment = raw.equipment as {
      make: string | null; model: string | null; serial_number: string | null;
      ship_to_locations: { address: string | null; city: string | null; state: string | null; zip: string | null } | null
    } | null

    let serviceAddress: string | null = null
    if (raw.ticket_type === 'outside') {
      // Use ticket-level service address for outside tickets
      serviceAddress = [raw.service_address, raw.service_city, raw.service_state, raw.service_zip]
        .filter(Boolean)
        .join(', ') || null
    } else if (equipment?.ship_to_locations) {
      const loc = equipment.ship_to_locations
      serviceAddress = [loc.address, loc.city, loc.state, loc.zip]
        .filter(Boolean)
        .join(', ') || null
    }

    const equipmentLine = [
      equipment?.make ?? raw.equipment_make,
      equipment?.model ?? raw.equipment_model,
    ].filter(Boolean).join(' ') || '—'

    // Load logo
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      const logoBuffer = fs.readFileSync(logoPath)
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`
    } catch {
      // Logo not found — render without it
    }

    const estimateParts = (raw.estimate_parts as ServicePartUsed[]) ?? []

    // Trip charge is already baked into estimate_amount (server recompute).
    // Derive the line as total − labor − parts so the printed row always
    // reconciles with the bottom line, regardless of when it was snapshotted.
    const laborTotalPdf = ((raw.estimate_labor_hours as number) ?? 0) * ((raw.estimate_labor_rate as number) ?? 0)
    const partsTotalPdf = estimateParts
      .filter((p) => !p.warranty_covered)
      .reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
    const tripChargePdf = Math.max(0, ((raw.estimate_amount as number) ?? 0) - laborTotalPdf - partsTotalPdf)

    const estimate = {
      workOrderNumber: raw.work_order_number as number | null,
      customerName: customer?.name ?? '—',
      accountNumber: customer?.account_number ?? null,
      serviceAddress,
      equipmentLine,
      serialNumber: equipment?.serial_number ?? raw.equipment_serial_number ?? null,
      contactName: raw.contact_name,
      contactEmail: raw.contact_email,
      contactPhone: raw.contact_phone,
      problemDescription: raw.problem_description,
      diagnosisNotes: raw.diagnosis_notes,
      billingType: raw.billing_type,
      laborHours: (raw.estimate_labor_hours as number) ?? 0,
      laborRate: (raw.estimate_labor_rate as number) ?? 0,
      parts: estimateParts.map((p) => ({
        description: p.description,
        detail: p.detail ?? null,
        quantity: p.quantity,
        unitPrice: p.unit_price,
        warrantyCovered: p.warranty_covered ?? false,
      })),
      tripCharge: tripChargePdf,
      estimateTotal: raw.estimate_amount as number,
      createdDate: new Date(raw.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    }

    // Render PDF. @react-pdf/renderer's renderToBuffer expects ReactElement<DocumentProps>;
    // EstimateDocument is a typed wrapper around <Document>. Using
    // React.createElement with explicit props gives us prop-typed errors at
    // build time without falling back to `as any`.
    const { getSetting } = await import('@/lib/db/settings')
    const companyName = (await getSetting('company_name')) || undefined

    const element = React.createElement(EstimateDocument, {
      estimate,
      logoBase64,
      companyName,
    })

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('[estimate-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const customerSlug = (customer?.name ?? 'Customer').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const woLabel = raw.work_order_number ? `WO-${raw.work_order_number}` : 'Estimate'
    const filename = `${woLabel}-Estimate-${customerSlug}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[estimate-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
