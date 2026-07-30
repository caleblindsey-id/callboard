import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { generatePmTickets, groupPendingReviewsByCustomer } from '@/lib/pm-generation'
import { enqueueCreditReviewsForCustomer } from '@/lib/credit-review'
import { notifyTechsOfGeneratedPms } from '@/lib/pm-tickets/notify-generated'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      month: number
      year: number
      preview?: boolean
    }
    const { month, year, preview = false } = body

    if (!month || !year || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'Valid month (1–12) and year are required' },
        { status: 400 }
      )
    }
    if (year < 2020 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await generatePmTickets({
      supabase,
      scope: { kind: 'all_active_for_month', month, year },
      createdById: user.id,
      preview,
    })

    if (preview) {
      return NextResponse.json({
        preview: true,
        wouldCreate: result.attempted,
        wouldFlag: result.flagged,
        skipped: result.skipped,
        // Credit-hold customers whose PMs WILL be created and sent to AR.
        creditHoldCustomers: result.creditHoldCustomers,
      })
    }

    // Live run: route every credit-hold PM into AR credit review — one email
    // per customer. Email failure is non-fatal (rows persist + are resendable).
    const byCustomer = groupPendingReviewsByCustomer(result.pendingReviewTickets)
    let emailedCustomers = 0
    let unemailedCustomers = 0
    for (const [customerId, info] of byCustomer) {
      const enqueue = await enqueueCreditReviewsForCustomer({
        customerId,
        customerName: info.customerName,
        accountNumber: info.customerAccount,
        tickets: info.tickets.map((t) => ({
          ticketType: 'pm' as const,
          ticketId: t.pmTicketId,
          orderLabel: t.orderLabel,
        })),
        createdById: user.id,
      })
      if (enqueue.emailed) emailedCustomers++
      else unemailedCustomers++
    }

    // Tell each tech their month is ready. Best-effort and fully contained: the
    // tickets are already committed, so a notification failure must never turn
    // a successful generation into an error the manager sees.
    let notifiedTechs = 0
    try {
      notifiedTechs = await notifyTechsOfGeneratedPms({
        // result.tickets, NOT result.created. created is a count, tickets is
        // the PmTicketRow[] of rows actually inserted this run.
        created: result.tickets,
        month,
        year,
      })
    } catch (err) {
      console.error('tickets/generate: tech notification failed', err)
    }

    return NextResponse.json({
      created: result.created,
      skipped: result.skipped,
      flagged: result.flagged,
      pendingReview: result.pendingReview,
      pendingReviewCustomers: byCustomer.size,
      creditReviewEmailed: emailedCustomers,
      creditReviewNotEmailed: unemailedCustomers,
      notifiedTechs,
      tickets: result.tickets,
    })
  } catch (err) {
    console.error('tickets/generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate tickets' },
      { status: 500 }
    )
  }
}
