export const runtime = 'nodejs'

import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getSetting } from '@/lib/db/settings'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderEstimateApprovalEmail } from '@/lib/email-templates/estimate-approval'

const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Only managers and coordinators can email estimates' },
        { status: 403 }
      )
    }

    const supabase = await createClient()

    const { data: ticket, error: fetchError } = await supabase
      .from('service_tickets')
      .select(`
        id,
        work_order_number,
        status,
        contact_name,
        contact_email,
        estimate_amount,
        customers ( name )
      `)
      .eq('id', id)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    if (ticket.status !== 'estimated') {
      return NextResponse.json(
        { error: 'Can only email estimates from tickets in the estimated state' },
        { status: 409 }
      )
    }

    const contactEmail = ticket.contact_email?.trim()
    if (!contactEmail) {
      return NextResponse.json(
        { error: 'No contact email on this ticket — add one before emailing the estimate.' },
        { status: 400 }
      )
    }

    // Persist a fresh approval token before sending so the URL in the email is
    // backed by a row in the DB, no matter what happens during/after the send.
    // 12-char base64url token — short enough to read at a glance, still 72 bits
    // of entropy (well past brute-force for a 7-day TTL).
    const approvalToken = randomBytes(9).toString('base64url')
    const approvalTokenExpiresAt = new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString()

    // Status-guarded UPDATE with .select() so we can detect concurrent
    // transitions (PGRST116 = no row matched). Without this, a race where the
    // ticket flipped to 'approved' between the SELECT and the UPDATE would
    // send an email pointing at a token that was never persisted → 404 on
    // click for the customer.
    const { error: tokenError } = await supabase
      .from('service_tickets')
      .update({
        approval_token: approvalToken,
        approval_token_expires_at: approvalTokenExpiresAt,
      })
      .eq('id', id)
      .eq('status', 'estimated')
      .select('id')
      .single()

    if (tokenError) {
      if (tokenError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Ticket status changed before send — refresh and try again.' },
          { status: 409 }
        )
      }
      console.error('send-estimate: token persist failed', tokenError)
      return NextResponse.json({ error: 'Failed to prepare approval token' }, { status: 500 })
    }

    const [companyName, supportPhone, fromEmail] = await Promise.all([
      getSetting('company_name'),
      getSetting('support_phone'),
      getSetting('email_from_address'),
    ])

    if (!fromEmail || fromEmail === 'no-reply@example.com') {
      return NextResponse.json(
        { error: 'Email from-address has not been configured. Update settings.email_from_address.' },
        { status: 500 }
      )
    }

    const customerJoin = ticket.customers as { name: string | null } | { name: string | null }[] | null
    const customerName = Array.isArray(customerJoin)
      ? customerJoin[0]?.name ?? null
      : customerJoin?.name ?? null

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
    if (!appUrl) {
      console.error('send-estimate: NEXT_PUBLIC_APP_URL is not set; refusing to send a relative approval URL')
      return NextResponse.json(
        { error: 'Public app URL is not configured. Set NEXT_PUBLIC_APP_URL.' },
        { status: 500 }
      )
    }
    const approvalUrl = `${appUrl}/e/${approvalToken}`

    const email = renderEstimateApprovalEmail({
      ticket: {
        work_order_number: ticket.work_order_number,
        customer_name: customerName,
        contact_name: ticket.contact_name,
        estimate_amount: ticket.estimate_amount,
      },
      approvalUrl,
      settings: {
        company_name: companyName ?? 'CallBoard',
        support_phone: supportPhone || null,
      },
    })

    let sendResult: Awaited<ReturnType<typeof sendMandrillEmail>>
    try {
      sendResult = await sendMandrillEmail({
        to: { email: contactEmail, name: ticket.contact_name ?? undefined },
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: ['estimate-approval'],
        metadata: {
          ticket_id: String(ticket.id),
          work_order: ticket.work_order_number ? String(ticket.work_order_number) : '',
        },
      })
    } catch (err) {
      console.error('send-estimate: Mandrill send failed', err)
      const message =
        err instanceof MandrillError
          ? err.message
          : 'Failed to send estimate email'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const sentAt = new Date().toISOString()
    const { error: stampError } = await supabase
      .from('service_tickets')
      .update({
        estimate_emailed_at: sentAt,
        estimate_email_message_id: sendResult.messageId,
      })
      .eq('id', id)

    if (stampError) {
      // Email already went out; just log so we don't surface a misleading error.
      console.error('send-estimate: stamp update failed (email already sent)', stampError)
    }

    return NextResponse.json({
      ok: true,
      message_id: sendResult.messageId,
      status: sendResult.status,
      emailed_at: sentAt,
      approval_url: approvalUrl,
    })
  } catch (err) {
    console.error('service-tickets/[id]/send-estimate POST error:', err)
    return NextResponse.json({ error: 'Failed to send estimate' }, { status: 500 })
  }
}
