import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { generatePmTickets } from '@/lib/pm-generation'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      month: number
      year: number
      preview?: boolean
      skipCreditHoldCustomerIds?: number[]
    }
    const { month, year, preview = false, skipCreditHoldCustomerIds = [] } = body

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

    try {
      const result = await generatePmTickets({
        supabase,
        scope: { kind: 'all_active_for_month', month, year },
        createdById: user.id,
        preview,
        skipCreditHoldCustomerIds,
        creditHoldReviewMode: 'skip',
      })

      if (preview) {
        return NextResponse.json({
          preview: true,
          wouldCreate: result.attempted,
          wouldFlag: result.flagged,
          skipped: result.skipped,
          creditHoldCustomers: result.creditHoldCustomers,
        })
      }

      return NextResponse.json({
        created: result.created,
        skipped: result.skipped,
        skippedCreditHold: result.skippedCreditHold,
        flagged: result.flagged,
        tickets: result.tickets,
      })
    } catch (innerErr) {
      // Validation surfaced from the shared service (e.g. non-credit-hold customer
      // in skipCreditHoldCustomerIds) is a 400, not a 500.
      if (innerErr instanceof Error && /is not on credit hold/.test(innerErr.message)) {
        return NextResponse.json({ error: innerErr.message }, { status: 400 })
      }
      throw innerErr
    }
  } catch (err) {
    console.error('tickets/generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate tickets' },
      { status: 500 }
    )
  }
}
