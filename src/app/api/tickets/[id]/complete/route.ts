import { NextRequest, NextResponse } from 'next/server'
import { completeTicket } from '@/lib/db/tickets'
import { PartUsed } from '@/types/database'

interface CompleteTicketBody {
  completedDate: string
  hoursWorked: number
  partsUsed: PartUsed[]
  completionNotes: string
  billingAmount: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteTicketBody

    const { completedDate, hoursWorked, partsUsed, completionNotes, billingAmount } = body

    if (!completedDate || hoursWorked === undefined || billingAmount === undefined) {
      return NextResponse.json(
        { error: 'completedDate, hoursWorked, and billingAmount are required' },
        { status: 400 }
      )
    }

    const updated = await completeTicket(id, {
      completedDate,
      hoursWorked,
      partsUsed: partsUsed ?? [],
      completionNotes: completionNotes ?? '',
      billingAmount,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id]/complete error:`, err)
    return NextResponse.json(
      { error: 'Failed to complete ticket' },
      { status: 500 }
    )
  }
}
