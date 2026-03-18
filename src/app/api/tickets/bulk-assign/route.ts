import { NextRequest, NextResponse } from 'next/server'
import { bulkAssignTechnician } from '@/lib/db/tickets'

interface BulkAssignBody {
  ticketIds: string[]
  technicianId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BulkAssignBody
    const { ticketIds, technicianId } = body

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (!technicianId) {
      return NextResponse.json(
        { error: 'technicianId is required' },
        { status: 400 }
      )
    }

    const updated = await bulkAssignTechnician(ticketIds, technicianId)

    return NextResponse.json(updated)
  } catch (err) {
    console.error('tickets/bulk-assign error:', err)
    return NextResponse.json(
      { error: 'Failed to bulk assign technician' },
      { status: 500 }
    )
  }
}
