import { NextRequest, NextResponse } from 'next/server'
import { updateTicket } from '@/lib/db/tickets'
import { PmTicketRow } from '@/types/database'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as Partial<PmTicketRow>

    const updated = await updateTicket(id, body)

    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id] PATCH error:`, err)
    return NextResponse.json(
      { error: 'Failed to update ticket' },
      { status: 500 }
    )
  }
}
