// @react-pdf/renderer requires the Node.js runtime (fs / canvas internals).
// Matches estimate-pdf, work-order-pdf, and billing/pdf.
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { PmQuoteDocument } from '@/lib/pdf/pm-quote-template'
import type { PmQuoteData, PmQuoteLine } from '@/lib/pdf/pm-quote-template'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/db/settings'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { INTERVAL_OPTIONS, MONTHS } from '@/lib/pm-schedule-options'
import { formatOneLineAddress } from '@/lib/utils/address'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// Quote PDF for a set of PM work orders.
//
// Stateless for now: the price comes straight off pm_schedules.flat_rate at
// render time. When quotes become records (pm_quotes), this moves to rendering
// the snapshot stored on the quote line so an accepted price can't drift when
// someone edits the schedule.
// ============================================================

interface RawShipTo {
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

interface RawQuoteTicket {
  id: string
  work_order_number: number | null
  status: string
  month: number | null
  year: number | null
  customer_id: number
  customers: {
    name: string
    account_number: string | null
    ar_terms: string | null
    billing_address: string | null
    billing_city: string | null
    billing_state: string | null
    billing_zip: string | null
    po_required: boolean | null
    tax_rate: number | null
    tax_exempt: boolean | null
  } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
    location_on_site: string | null
    contact_name: string | null
    contact_phone: string | null
    ship_to_locations: RawShipTo | null
  } | null
  ticket_ship_to: RawShipTo | null
  pm_schedules: {
    billing_type: string | null
    flat_rate: number | null
    interval_months: number | null
  } | null
}

function frequencyLabel(intervalMonths: number | null | undefined): string {
  const match = INTERVAL_OPTIONS.find((o) => o.value === intervalMonths)
  if (match) return match.label
  if (intervalMonths && intervalMonths > 0) return `Every ${intervalMonths} mo`
  return '—'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ticketIds = body?.ticketIds

    if (!Array.isArray(ticketIds) || ticketIds.length === 0 || !ticketIds.every((t) => typeof t === 'string')) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // A soft-deleted ticket must never price into a customer document, and the
    // strict count check below turns a filtered-out id into a hard failure
    // rather than a silently short quote.
    const { data: rawTickets, error: fetchError } = await supabase
      .from('pm_tickets')
      .select(`
        id,
        work_order_number,
        status,
        month,
        year,
        customer_id,
        customers(name, account_number, ar_terms, billing_address, billing_city, billing_state, billing_zip, po_required, tax_rate, tax_exempt),
        equipment(make, model, serial_number, description, location_on_site, contact_name, contact_phone, ship_to_locations(name, address, city, state, zip)),
        ticket_ship_to:ship_to_locations(name, address, city, state, zip),
        pm_schedules(billing_type, flat_rate, interval_months)
      `)
      .in('id', ticketIds as string[])
      .is('deleted_at', null)

    if (fetchError) {
      console.error('[quote-pdf] Supabase fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch ticket data' }, { status: 500 })
    }

    const tickets = (rawTickets ?? []) as unknown as RawQuoteTicket[]

    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'One or more selected tickets could not be found. Refresh the board and try again.' },
        { status: 409 }
      )
    }

    // A quote is addressed to one customer.
    const customerIds = new Set(tickets.map((t) => t.customer_id))
    if (customerIds.size > 1) {
      return NextResponse.json(
        { error: 'All selected work orders must belong to the same customer to appear on one quote.' },
        { status: 400 }
      )
    }

    // Only flat-rate schedules carry a quotable number. Time & materials and
    // contract schedules have none, and printing $0.00 would put a wrong figure
    // in front of a customer.
    const unquotable = tickets.filter(
      (t) =>
        t.pm_schedules?.billing_type !== 'flat_rate' ||
        !t.pm_schedules?.flat_rate ||
        Number(t.pm_schedules.flat_rate) <= 0
    )
    if (unquotable.length > 0) {
      const labels = unquotable.map((t) => `WO-${t.work_order_number ?? t.id.slice(0, 8)}`).join(', ')
      return NextResponse.json(
        {
          error: `These work orders have no flat rate on their PM schedule and cannot be quoted: ${labels}. Set a flat rate on the schedule, or quote them manually.`,
        },
        { status: 400 }
      )
    }

    const customer = tickets[0].customers
    if (!customer) {
      return NextResponse.json({ error: 'Customer record missing on the selected tickets' }, { status: 409 })
    }

    // Sort by work order number so the printed order is stable and predictable.
    const sorted = [...tickets].sort(
      (a, b) => (a.work_order_number ?? 0) - (b.work_order_number ?? 0)
    )

    const lines: PmQuoteLine[] = sorted.map((t) => ({
      workOrderNumber: t.work_order_number,
      equipmentLine:
        [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || 'Equipment',
      equipmentDescription: t.equipment?.description ?? null,
      serialNumber: t.equipment?.serial_number ?? null,
      frequencyLabel: frequencyLabel(t.pm_schedules?.interval_months),
      amount: Number(t.pm_schedules?.flat_rate ?? 0),
    }))

    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100

    // The ticket-level ship-to is a snapshot and wins over the equipment's
    // current one (migration 049). Fall back to the equipment's, then to none.
    const shipTo = sorted[0].ticket_ship_to ?? sorted[0].equipment?.ship_to_locations ?? null

    const siteContact = [sorted[0].equipment?.contact_name, sorted[0].equipment?.contact_phone]
      .filter(Boolean)
      .join('  |  ') || null

    const periodMonth = sorted[0].month
    const periodYear = sorted[0].year
    const monthLabel = MONTHS.find((m) => m.value === periodMonth)?.label
    const allSamePeriod = sorted.every((t) => t.month === periodMonth && t.year === periodYear)
    const servicePeriod = allSamePeriod && monthLabel && periodYear ? `${monthLabel} ${periodYear}` : null

    const quote: PmQuoteData = {
      quoteNumber: null,
      preparedDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      servicePeriod,
      customerName: customer.name,
      accountNumber: customer.account_number,
      billingAddress: formatOneLineAddress(
        customer.billing_address,
        customer.billing_city,
        customer.billing_state,
        customer.billing_zip
      ),
      siteName: shipTo?.name ?? null,
      siteAddress: formatOneLineAddress(shipTo?.address, shipTo?.city, shipTo?.state, shipTo?.zip),
      siteContact,
      arTerms: customer.ar_terms,
      poRequired: !!customer.po_required,
      lines,
      subtotal,
      taxExempt: !!customer.tax_exempt,
    }

    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    } catch {
      // Logo not found — the header falls back to the company name.
    }

    const [companyName, serviceEmail, servicePhone] = await Promise.all([
      getSetting('company_name'),
      getSetting('service_email'),
      getSetting('service_phone'),
    ])

    const element = React.createElement(PmQuoteDocument, {
      quote,
      logoBase64,
      companyName: companyName || undefined,
      serviceEmail,
      servicePhone,
    })

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('[quote-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const customerSlug = customer.name.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const filename = `PM-Quote-${customerSlug}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[quote-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
