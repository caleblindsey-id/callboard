// @react-pdf/renderer requires Node.js runtime (uses fs / canvas internals).
// Match estimate-pdf and work-order-pdf which already declare this.
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { BillingDocument } from '@/lib/pdf/billing-template'
import { createClient } from '@/lib/supabase/server'
import { getSetting, getLaborRate } from '@/lib/db/settings'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { MONTHS } from '@/lib/pm-schedule-options'
import { APP_NAME } from '@/lib/branding'

// ============================================================
// Types
// ============================================================

interface PartLine {
  productNumber: string | null
  description: string
  quantity: number
  unit_price: number
}

interface BillingTicket {
  id: string
  workOrderNumber: number
  customerName: string
  accountNumber: string | null
  billingAddress: string | null
  serviceLocation: string | null
  arTerms: string | null
  equipmentMake: string | null
  equipmentModel: string | null
  serialNumber: string | null
  locationOnSite: string | null
  equipmentContactName: string | null
  equipmentContactEmail: string | null
  equipmentContactPhone: string | null
  technicianName: string
  completedDate: string
  hoursWorked: number | null
  machineHours: number | null
  dateCode: string | null
  completionNotes: string | null
  partsUsed: PartLine[]
  additionalPartsUsed: PartLine[]
  additionalHoursWorked: number | null
  laborRate: number
  billingAmount: number | null
  billingType: string | null
  flatRate: number | null
  poRequired: boolean
  poNumber: string | null
  billingContactName: string | null
  billingContactEmail: string | null
  billingContactPhone: string | null
  customerSignature: string | null
  customerSignatureName: string | null
  photoUrls: string[]
}

// Raw Supabase join shape
interface RawTicket {
  id: string
  work_order_number: number
  pm_schedule_id: string | null
  completed_date: string | null
  hours_worked: number | null
  completion_notes: string | null
  parts_used: Array<{
    synergy_product_id?: number
    quantity: number
    description?: string
    unit_price: number
  }> | null
  additional_parts_used: Array<{
    synergy_product_id?: number
    quantity: number
    description?: string
    unit_price: number
  }> | null
  additional_hours_worked: number | null
  machine_hours: number | null
  date_code: string | null
  billing_amount: number | null
  customers: {
    name: string
    account_number: string | null
    ar_terms: string | null
    billing_address: string | null
    billing_city: string | null
    billing_state: string | null
    billing_zip: string | null
    po_required: boolean
  } | null
  po_number: string | null
  billing_contact_name: string | null
  billing_contact_email: string | null
  billing_contact_phone: string | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    location_on_site: string | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    ship_to_locations: {
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  technician: { name: string } | null
  pm_schedules: { billing_type: string | null; flat_rate: number | null } | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: Array<{ storage_path: string; uploaded_at: string }> | null
  labor_rate_type: string | null
}

// ============================================================
// POST /api/billing/pdf
// ============================================================

export async function POST(request: NextRequest) {
  try {
    // --- Parse and validate body ---
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { ticketIds, month, year } = body as {
      ticketIds?: unknown
      month?: unknown
      year?: unknown
    }

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

    const monthNum = Number(month)
    const yearNum = Number(year)

    if (
      !Number.isInteger(monthNum) ||
      monthNum < 1 ||
      monthNum > 12 ||
      !Number.isInteger(yearNum) ||
      yearNum < 2000 ||
      yearNum > 2100
    ) {
      return NextResponse.json(
        { error: 'month must be 1–12 and year must be a valid 4-digit year' },
        { status: 400 }
      )
    }

    // --- Verify auth and role ---
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // --- Fetch ticket data from Supabase ---

    const { data: rawTickets, error: ticketsError } = await supabase
      .from('pm_tickets')
      .select(`
        id,
        work_order_number,
        pm_schedule_id,
        completed_date,
        hours_worked,
        machine_hours,
        date_code,
        completion_notes,
        parts_used,
        additional_parts_used,
        additional_hours_worked,
        billing_amount,
        customer_signature,
        customer_signature_name,
        photos,
        po_number,
        billing_contact_name,
        billing_contact_email,
        billing_contact_phone,
        labor_rate_type,
        customers(name, account_number, ar_terms, billing_address, billing_city, billing_state, billing_zip, po_required),
        equipment(make, model, serial_number, location_on_site, contact_name, contact_email, contact_phone, ship_to_locations(address, city, state, zip)),
        technician:users!assigned_technician_id(name),
        pm_schedules(billing_type, flat_rate)
      `)
      .in('id', ticketIds as string[])
      .eq('status', 'completed')
      .is('deleted_at', null)

    if (ticketsError) {
      console.error('[billing/pdf] Supabase fetch error:', ticketsError)
      return NextResponse.json({ error: 'Failed to fetch ticket data' }, { status: 500 })
    }

    if (!rawTickets || rawTickets.length === 0) {
      return NextResponse.json({ error: 'No tickets found for the provided IDs' }, { status: 404 })
    }

    // --- Validate PO requirements ---
    const missingPoTickets = (rawTickets as RawTicket[]).filter(
      (t) => t.customers?.po_required && !t.po_number
    )

    if (missingPoTickets.length > 0) {
      const names = missingPoTickets
        .map((t) => `WO#${t.work_order_number} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        {
          error: `Cannot export — ${missingPoTickets.length} ticket(s) missing required PO: ${names}`,
        },
        { status: 400 }
      )
    }

    // --- Collect all unique synergy_product_ids to resolve descriptions ---
    const productIdSet = new Set<number>()
    for (const ticket of rawTickets as RawTicket[]) {
      for (const part of [...(ticket.parts_used ?? []), ...(ticket.additional_parts_used ?? [])]) {
        if (typeof part.synergy_product_id === 'number') {
          productIdSet.add(part.synergy_product_id)
        }
      }
    }

    // Build lookup maps from the products table.
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

    // --- Generate signed URLs for ticket photos in batch ---
    // 600s TTL bounds the URL lifetime to longer than even a slow batch render.
    // createSignedUrls (plural) batches one call per ticket instead of one per
    // photo — a batch of 20 tickets × 5 photos was previously 100 serial round
    // trips. Per-ticket calls run in parallel via Promise.all.
    const photoUrlMap = new Map<string, string[]>()
    await Promise.all(
      (rawTickets as RawTicket[]).map(async (raw) => {
        const photos = raw.photos ?? []
        const paths = photos.map((p) => p.storage_path).filter(Boolean)
        if (paths.length === 0) {
          photoUrlMap.set(raw.id, [])
          return
        }
        try {
          const { data } = await supabase.storage
            .from('ticket-photos')
            .createSignedUrls(paths, 600)
          const urls = (data ?? [])
            .map((d) => d.signedUrl)
            .filter((u): u is string => !!u)
          photoUrlMap.set(raw.id, urls)
        } catch {
          photoUrlMap.set(raw.id, [])
        }
      })
    )

    // --- Fetch all labor rates + company name from settings ---
    const [standardRate, industrialRate, vacuumRate, companyName] = await Promise.all([
      getLaborRate('standard'),
      getLaborRate('industrial'),
      getLaborRate('vacuum'),
      getSetting('company_name'),
    ])
    const laborRateByType: Record<string, number> = {
      standard: standardRate,
      industrial: industrialRate,
      vacuum: vacuumRate,
    }

    // --- Map raw tickets to BillingTicket[] ---
    const tickets: BillingTicket[] = (rawTickets as RawTicket[]).map((raw) => {
      const laborRate = laborRateByType[raw.labor_rate_type ?? 'standard'] ?? standardRate
      const partsUsed: PartLine[] = (raw.parts_used ?? []).map((part) => ({
        productNumber:
          (typeof part.synergy_product_id === 'number' &&
            productNumMap.get(part.synergy_product_id)) || null,
        description:
          (typeof part.synergy_product_id === 'number' &&
            productDescMap.get(part.synergy_product_id)) ||
          part.description ||
          'Unknown part',
        quantity: part.quantity,
        unit_price: part.unit_price,
      }))

      const technicianEntry = raw.technician
      const technicianName =
        Array.isArray(technicianEntry)
          ? (technicianEntry[0]?.name ?? '—')
          : (technicianEntry?.name ?? '—')

      // Build service location: prefer ship-to, fall back to customer billing address
      const shipTo = raw.equipment?.ship_to_locations
      let serviceLocation: string | null = null
      if (shipTo && (shipTo.address || shipTo.city)) {
        serviceLocation = [shipTo.address, shipTo.city, shipTo.state, shipTo.zip]
          .filter(Boolean)
          .join(', ')
      } else {
        serviceLocation = raw.customers?.billing_address ?? null
      }

      return {
        id: raw.id,
        workOrderNumber: raw.work_order_number,
        customerName: raw.customers?.name ?? '—',
        accountNumber: raw.customers?.account_number ?? null,
        billingAddress: raw.customers?.billing_address ?? null,
        serviceLocation,
        arTerms: raw.customers?.ar_terms ?? null,
        equipmentMake: raw.equipment?.make ?? null,
        equipmentModel: raw.equipment?.model ?? null,
        serialNumber: raw.equipment?.serial_number ?? null,
        locationOnSite: raw.equipment?.location_on_site ?? null,
        equipmentContactName: raw.equipment?.contact_name ?? null,
        equipmentContactEmail: raw.equipment?.contact_email ?? null,
        equipmentContactPhone: raw.equipment?.contact_phone ?? null,
        technicianName,
        completedDate: raw.completed_date
          ? new Date(raw.completed_date).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : '—',
        hoursWorked: raw.hours_worked,
        machineHours: raw.machine_hours,
        dateCode: raw.date_code,
        completionNotes: raw.completion_notes,
        partsUsed,
        additionalPartsUsed: (raw.additional_parts_used ?? []).map((part) => ({
          productNumber:
            (typeof part.synergy_product_id === 'number' &&
              productNumMap.get(part.synergy_product_id)) || null,
          description:
            (typeof part.synergy_product_id === 'number' &&
              productDescMap.get(part.synergy_product_id)) ||
            part.description ||
            'Unknown part',
          quantity: part.quantity,
          unit_price: part.unit_price,
        })),
        additionalHoursWorked: raw.additional_hours_worked,
        laborRate,
        billingAmount: raw.billing_amount,
        billingType: raw.pm_schedules?.billing_type ?? null,
        flatRate: raw.pm_schedules?.flat_rate ?? null,
        poRequired: raw.customers?.po_required ?? false,
        poNumber: raw.po_number ?? null,
        billingContactName: raw.billing_contact_name ?? null,
        billingContactEmail: raw.billing_contact_email ?? null,
        billingContactPhone: raw.billing_contact_phone ?? null,
        customerSignature: raw.customer_signature ?? null,
        customerSignatureName: raw.customer_signature_name ?? null,
        photoUrls: photoUrlMap.get(raw.id) ?? [],
      }
    })

    // --- Render PDF FIRST, then mark exported ---
    // Previous order (mark-then-render) guaranteed that any render failure
    // left tickets permanently in `billed` state with no PDF. Now: render
    // first, and use a compare-and-swap UPDATE (.eq('billing_exported', false))
    // so a duplicate retry safely no-ops when the first call already won.
    const exportedAt = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const element = React.createElement(BillingDocument, {
      tickets,
      month: monthNum,
      year: yearNum,
      exportedAt,
      companyName: companyName || APP_NAME,
    } as Parameters<typeof BillingDocument>[0])

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('[billing/pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    // Mark tickets as exported only AFTER successful render. CAS on
    // billing_exported=false: a concurrent retry would match zero rows and
    // be skipped (the first request already won the race).
    const { data: marked, error: updateError } = await supabase
      .from('pm_tickets')
      .update({ billing_exported: true, status: 'billed' })
      .in('id', ticketIds as string[])
      .eq('billing_exported', false)
      .select('id')

    if (updateError) {
      console.error('[billing/pdf] Failed to mark tickets as exported:', updateError)
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

    // --- Return PDF ---
    // Use the shared MONTHS list so the filename never depends on the server's
    // locale (Intl on a non-en-US server could emit accented characters that
    // RFC 6266 quoted-string filenames don't allow).
    const monthName = MONTHS.find((m) => m.value === monthNum)?.label ?? String(monthNum)
    const filename = `PM-Billing-${monthName}-${yearNum}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[billing/pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
