export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { ServiceWorkOrderDocument } from '@/lib/pdf/service-work-order-template'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getLaborRate, getSetting } from '@/lib/db/settings'
import type { ServicePartUsed } from '@/types/service-tickets'
import * as fs from 'fs'
import * as path from 'path'

// Customer-facing completion document for a service ticket — parity with the PM
// /api/tickets/[id]/work-order-pdf route.
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
        completion_notes,
        completed_at,
        hours_worked,
        machine_hours,
        date_code,
        estimate_labor_rate,
        labor_rate_type,
        parts_used,
        diagnostic_charge,
        billing_amount,
        customer_signature,
        customer_signature_name,
        photos,
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
        customers(name, account_number),
        equipment:equipment!service_tickets_equipment_id_fkey(
          make, model, serial_number,
          ship_to_locations(address, city, state, zip)
        ),
        assigned_technician:users!service_tickets_assigned_technician_id_fkey(name)
      `)
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

    const customer = raw.customers as { name: string; account_number: string | null } | null
    const equipment = raw.equipment as {
      make: string | null; model: string | null; serial_number: string | null
      ship_to_locations: { address: string | null; city: string | null; state: string | null; zip: string | null } | null
    } | null

    let serviceAddress: string | null = null
    if (raw.ticket_type === 'outside') {
      serviceAddress = [raw.service_address, raw.service_city, raw.service_state, raw.service_zip]
        .filter(Boolean).join(', ') || null
    } else if (equipment?.ship_to_locations) {
      const loc = equipment.ship_to_locations
      serviceAddress = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ') || null
    }

    const equipmentLine = [
      equipment?.make ?? raw.equipment_make,
      equipment?.model ?? raw.equipment_model,
    ].filter(Boolean).join(' ') || '—'

    const technicianEntry = raw.assigned_technician as { name: string } | { name: string }[] | null
    const technicianName = Array.isArray(technicianEntry)
      ? (technicianEntry[0]?.name ?? '—')
      : (technicianEntry?.name ?? '—')

    // Signed URLs for completion photos (short-lived; PDF embeds them at render).
    const photos = (raw.photos ?? []) as Array<{ storage_path: string }>
    const photoUrls: string[] = []
    for (const photo of photos) {
      try {
        const { data } = await supabase.storage
          .from('ticket-photos')
          .createSignedUrl(photo.storage_path, 120)
        if (data?.signedUrl) photoUrls.push(data.signedUrl)
      } catch {
        // Skip failed photos
      }
    }

    // Informational labor rate for the breakdown — the snapshot from estimate
    // time, falling back to the current rate for the ticket's labor type. The
    // authoritative figure printed as Total is billing_amount (server-computed).
    const laborRate = (raw.estimate_labor_rate as number | null)
      ?? await getLaborRate((raw.labor_rate_type as string | null) ?? 'standard')

    const partsUsed = (raw.parts_used as ServicePartUsed[]) ?? []

    // Load logo
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    } catch {
      // render without logo
    }

    const companyName = (await getSetting('company_name')) || undefined

    const workOrder = {
      workOrderNumber: raw.work_order_number as number | null,
      customerName: customer?.name ?? '—',
      accountNumber: customer?.account_number ?? null,
      serviceAddress,
      equipmentLine,
      serialNumber: equipment?.serial_number ?? raw.equipment_serial_number ?? null,
      machineHours: raw.machine_hours as number | null,
      dateCode: raw.date_code as string | null,
      contactName: raw.contact_name as string | null,
      contactEmail: raw.contact_email as string | null,
      contactPhone: raw.contact_phone as string | null,
      problemDescription: raw.problem_description as string,
      diagnosisNotes: raw.diagnosis_notes as string | null,
      workPerformed: raw.completion_notes as string | null,
      technicianName,
      completedDate: raw.completed_at
        ? new Date(raw.completed_at as string).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          })
        : '—',
      billingType: raw.billing_type as string,
      laborHours: (raw.hours_worked as number | null) ?? 0,
      laborRate,
      parts: partsUsed.map((p) => ({
        description: p.description,
        detail: p.detail ?? null,
        quantity: p.quantity,
        unitPrice: p.unit_price,
        warrantyCovered: p.warranty_covered ?? false,
      })),
      diagnosticCharge: (raw.diagnostic_charge as number | null) ?? 0,
      billingTotal: (raw.billing_amount as number | null) ?? 0,
      customerSignature: raw.customer_signature as string | null,
      customerSignatureName: raw.customer_signature_name as string | null,
      photoUrls,
    }

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

    const customerSlug = (customer?.name ?? 'Customer').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const woLabel = raw.work_order_number ? `WO-${raw.work_order_number}` : 'WorkOrder'
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
