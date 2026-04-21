export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { CustomerWorkOrderDocument } from '@/lib/pdf/work-order-template'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'
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
      .from('pm_tickets')
      .select(`
        id,
        work_order_number,
        po_number,
        status,
        completed_date,
        hours_worked,
        machine_hours,
        date_code,
        completion_notes,
        parts_used,
        additional_parts_used,
        additional_hours_worked,
        customer_signature,
        customer_signature_name,
        photos,
        assigned_technician_id,
        customers(name, account_number, billing_address, billing_city, billing_state, billing_zip),
        equipment(make, model, serial_number, location_on_site, contact_name, contact_email, contact_phone, ship_to_locations(address, city, state, zip)),
        technician:users!assigned_technician_id(name)
      `)
      .eq('id', id)
      .single()

    if (fetchError || !raw) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Must be completed or billed
    if (raw.status !== 'completed' && raw.status !== 'billed') {
      return NextResponse.json({ error: 'Ticket must be completed to generate work order' }, { status: 400 })
    }

    // Techs can only generate for their own tickets
    if (isTechnician(user.role) && raw.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Resolve product numbers
    type RawPart = { synergy_product_id?: number; quantity: number; description?: string; unit_price: number }
    const allParts = [...(raw.parts_used as RawPart[] ?? []), ...(raw.additional_parts_used as RawPart[] ?? [])]
    const productIdSet = new Set<number>()
    for (const part of allParts) {
      if (typeof part.synergy_product_id === 'number') {
        productIdSet.add(part.synergy_product_id)
      }
    }

    // synergy_product_id is stored inconsistently: equipment default parts hold
    // products.id (PK), tech-entered parts hold Number(products.synergy_id).
    // Match on either and index both into the map so lookup works uniformly.
    const productDescMap = new Map<number, string>()
    const productNumMap = new Map<number, string>()
    if (productIdSet.size > 0) {
      const ids = Array.from(productIdSet)
      const { data: products } = await supabase
        .from('products')
        .select('id, synergy_id, number, description')
        .or(`id.in.(${ids.join(',')}),synergy_id.in.(${ids.map(String).join(',')})`)

      for (const p of products ?? []) {
        if (p.description) {
          if (p.id != null) productDescMap.set(p.id, p.description)
          if (p.synergy_id) productDescMap.set(Number(p.synergy_id), p.description)
        }
        if (p.number) {
          if (p.id != null) productNumMap.set(p.id, p.number)
          if (p.synergy_id) productNumMap.set(Number(p.synergy_id), p.number)
        }
      }
    }

    function mapParts(parts: RawPart[]) {
      return parts.map((part) => ({
        productNumber:
          (typeof part.synergy_product_id === 'number' &&
            productNumMap.get(part.synergy_product_id)) || null,
        description:
          (typeof part.synergy_product_id === 'number' &&
            productDescMap.get(part.synergy_product_id)) ||
          part.description ||
          'Unknown part',
        quantity: part.quantity,
      }))
    }

    // Generate signed URLs for photos
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

    // Build service location
    const shipTo = (raw.equipment as Record<string, unknown>)?.ship_to_locations as { address?: string; city?: string; state?: string; zip?: string } | null
    const customer = raw.customers as { name: string; account_number: string | null; billing_address: string | null; billing_city: string | null; billing_state: string | null; billing_zip: string | null } | null
    const equipment = raw.equipment as { make: string | null; model: string | null; serial_number: string | null; location_on_site: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null } | null

    let serviceLocation: string | null = null
    if (shipTo && (shipTo.address || shipTo.city)) {
      serviceLocation = [shipTo.address, shipTo.city, shipTo.state, shipTo.zip]
        .filter(Boolean)
        .join(', ')
    } else if (customer) {
      serviceLocation = [customer.billing_address, customer.billing_city, customer.billing_state, customer.billing_zip]
        .filter(Boolean)
        .join(', ') || null
    }

    const technicianEntry = raw.technician as { name: string } | { name: string }[] | null
    const technicianName = Array.isArray(technicianEntry)
      ? (technicianEntry[0]?.name ?? '—')
      : (technicianEntry?.name ?? '—')

    // Load logo
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      const logoBuffer = fs.readFileSync(logoPath)
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`
    } catch {
      // Logo not found — will render without it
    }

    const ticket = {
      workOrderNumber: raw.work_order_number as number,
      poNumber: raw.po_number as string | null,
      customerName: customer?.name ?? '—',
      accountNumber: customer?.account_number ?? null,
      serviceLocation,
      equipmentMake: equipment?.make ?? null,
      equipmentModel: equipment?.model ?? null,
      serialNumber: equipment?.serial_number ?? null,
      locationOnSite: equipment?.location_on_site ?? null,
      equipmentContactName: equipment?.contact_name ?? null,
      equipmentContactEmail: equipment?.contact_email ?? null,
      equipmentContactPhone: equipment?.contact_phone ?? null,
      technicianName,
      completedDate: raw.completed_date
        ? new Date(raw.completed_date as string).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '—',
      hoursWorked: raw.hours_worked as number | null,
      machineHours: raw.machine_hours as number | null,
      dateCode: raw.date_code as string | null,
      completionNotes: raw.completion_notes as string | null,
      pmParts: mapParts(raw.parts_used as RawPart[] ?? []),
      additionalParts: mapParts(raw.additional_parts_used as RawPart[] ?? []),
      additionalHoursWorked: raw.additional_hours_worked as number | null,
      customerSignature: raw.customer_signature as string | null,
      customerSignatureName: raw.customer_signature_name as string | null,
      photoUrls,
    }

    // Render PDF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(CustomerWorkOrderDocument as any, {
      ticket,
      logoBase64,
    })

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as any)
    } catch (renderErr) {
      console.error('[work-order-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const customerSlug = (customer?.name ?? 'Customer').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const filename = `WO-${raw.work_order_number}-${customerSlug}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[work-order-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
