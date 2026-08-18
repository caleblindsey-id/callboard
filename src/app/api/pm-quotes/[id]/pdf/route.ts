// @react-pdf/renderer requires the Node.js runtime (fs / canvas internals).
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
import { MONTHS } from '@/lib/pm-schedule-options'
import { frequencyLabel } from '@/lib/pm-quotes/build'
import { formatOneLineAddress } from '@/lib/utils/address'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// POST /api/pm-quotes/[id]/pdf
//
// Renders from the SNAPSHOT on pm_quote_lines, never from pm_schedules. That is
// the whole reason the lines carry their own price and equipment text: editing
// a schedule must not change what a customer was already quoted or accepted.
//
// Customer, address, and service-period context is still read live, because
// those are ways of reaching the same customer rather than terms of the deal.
// ============================================================

interface RawShipTo {
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: quoteRow, error: quoteError } = await supabase
      .from('pm_quotes')
      .select(`
        id,
        quote_number,
        status,
        subtotal,
        valid_until,
        created_at,
        customers(name, account_number, ar_terms, billing_address, billing_city, billing_state, billing_zip, po_required, tax_rate, tax_exempt),
        pm_quote_lines(pm_ticket_id, work_order_number, equipment_label, equipment_description, serial_number, interval_months, amount, sort_order)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (quoteError || !quoteRow) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const raw = quoteRow as unknown as {
      quote_number: number
      subtotal: number
      created_at: string
      customers: {
        name: string
        account_number: string | null
        ar_terms: string | null
        billing_address: string | null
        billing_city: string | null
        billing_state: string | null
        billing_zip: string | null
        po_required: boolean | null
        tax_exempt: boolean | null
      } | null
      pm_quote_lines: Array<{
        pm_ticket_id: string
        work_order_number: number | null
        equipment_label: string | null
        equipment_description: string | null
        serial_number: string | null
        interval_months: number | null
        amount: number
        sort_order: number
      }>
    }

    const customer = raw.customers
    if (!customer) {
      return NextResponse.json({ error: 'Customer record missing on this quote' }, { status: 409 })
    }

    const quoteLines = [...(raw.pm_quote_lines ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || (a.work_order_number ?? 0) - (b.work_order_number ?? 0)
    )

    if (quoteLines.length === 0) {
      return NextResponse.json({ error: 'This quote has no work orders on it' }, { status: 409 })
    }

    const lines: PmQuoteLine[] = quoteLines.map((l) => ({
      workOrderNumber: l.work_order_number,
      equipmentLine: l.equipment_label ?? 'Equipment',
      equipmentDescription: l.equipment_description,
      serialNumber: l.serial_number,
      frequencyLabel: frequencyLabel(l.interval_months),
      amount: Number(l.amount),
    }))

    // Where the work happens. Read live off the quoted tickets: the service
    // address is how to reach the customer, not a term of the deal.
    const { data: ticketRows } = await supabase
      .from('pm_tickets')
      .select(`
        month,
        year,
        equipment(contact_name, contact_phone, ship_to_locations(name, address, city, state, zip)),
        ticket_ship_to:ship_to_locations(name, address, city, state, zip)
      `)
      .in('id', quoteLines.map((l) => l.pm_ticket_id))
      .is('deleted_at', null)

    const tickets = (ticketRows ?? []) as unknown as Array<{
      month: number | null
      year: number | null
      equipment: {
        contact_name: string | null
        contact_phone: string | null
        ship_to_locations: RawShipTo | null
      } | null
      ticket_ship_to: RawShipTo | null
    }>

    const first = tickets[0]
    const shipTo = first?.ticket_ship_to ?? first?.equipment?.ship_to_locations ?? null
    const siteContact =
      [first?.equipment?.contact_name, first?.equipment?.contact_phone].filter(Boolean).join('  |  ') ||
      null

    const periodMonth = first?.month ?? null
    const periodYear = first?.year ?? null
    const monthLabel = MONTHS.find((m) => m.value === periodMonth)?.label
    const samePeriod =
      tickets.length > 0 && tickets.every((t) => t.month === periodMonth && t.year === periodYear)
    const servicePeriod =
      samePeriod && monthLabel && periodYear ? `${monthLabel} ${periodYear}` : null

    const quote: PmQuoteData = {
      quoteNumber: raw.quote_number,
      preparedDate: new Date(raw.created_at).toLocaleDateString('en-US', {
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
      subtotal: Number(raw.subtotal),
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
      console.error('[pm-quote-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const customerSlug = customer.name.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)
    const filename = `Q-${raw.quote_number}-${customerSlug}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[pm-quote-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
