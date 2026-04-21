import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeServiceTicket } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import type { ServicePartUsed } from '@/types/service-tickets'
import type { TicketPhoto } from '@/types/database'

interface CompleteServiceTicketBody {
  completed_at: string
  hours_worked: number
  parts_used: ServicePartUsed[]
  completion_notes: string | null
  customer_signature: string
  customer_signature_name: string
  photos: TicketPhoto[]
  billing_amount?: number
  warranty_labor_covered?: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteServiceTicketBody

    const { completed_at, hours_worked, parts_used, completion_notes, customer_signature, customer_signature_name, photos } = body

    // Validate required fields
    if (!completed_at || hours_worked === undefined) {
      return NextResponse.json(
        { error: 'completed_at and hours_worked are required' },
        { status: 400 }
      )
    }

    if (!customer_signature || !customer_signature_name) {
      return NextResponse.json(
        { error: 'Customer signature and printed name are required' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch current ticket
    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('status, assigned_technician_id, billing_type')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Techs can only complete their own assigned tickets
    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Must be in_progress to complete
    if (current.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Ticket must be in_progress to complete (currently: ${current.status})` },
        { status: 409 }
      )
    }

    // Compute billing amount based on billing type
    let finalBillingAmount: number

    if (body.billing_amount !== undefined && !isTechnician(user.role)) {
      // Managers can override billing amount
      finalBillingAmount = body.billing_amount
    } else {
      // Server-computed billing
      const billingType = current.billing_type as string

      if (billingType === 'warranty') {
        // Full warranty: $0
        finalBillingAmount = 0
      } else {
        // Fetch labor rate from settings
        const { data: settings } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'labor_rate_per_hour')
          .single()
        const laborRate = settings ? parseFloat(settings.value) : 75

        const finalParts = parts_used ?? []

        if (billingType === 'partial_warranty') {
          // Parts covered by warranty, labor billed
          const laborTotal = hours_worked * laborRate
          // Only bill parts NOT covered by warranty
          const partsTotal = finalParts
            .filter(p => !p.warranty_covered)
            .reduce((sum, p) => sum + (p.quantity * p.unit_price), 0)
          finalBillingAmount = laborTotal + partsTotal
        } else {
          // non_warranty: bill everything
          const laborTotal = hours_worked * laborRate
          const partsTotal = finalParts.reduce(
            (sum, p) => sum + (p.quantity * p.unit_price), 0
          )
          finalBillingAmount = laborTotal + partsTotal
        }
      }
    }

    const updated = await completeServiceTicket(id, {
      completed_at,
      hours_worked,
      parts_used: parts_used ?? [],
      completion_notes: completion_notes ?? null,
      billing_amount: finalBillingAmount,
      customer_signature,
      customer_signature_name,
      photos: photos ?? [],
      warranty_labor_covered: body.warranty_labor_covered,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('service-tickets/[id]/complete error:', err)
    return NextResponse.json(
      { error: 'Failed to complete service ticket' },
      { status: 500 }
    )
  }
}
