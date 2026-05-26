import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { MANAGER_ROLES } from '@/types/database'
import { getCustomerNotes, createCustomerNote } from '@/lib/db/customer-notes'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const customerId = parseInt(id)
  if (isNaN(customerId)) {
    return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })
  }

  const notes = await getCustomerNotes(customerId)
  return NextResponse.json(notes)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!MANAGER_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const customerId = parseInt(id)
  if (isNaN(customerId)) {
    return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })
  }

  const body = await request.json()
  const noteText = (body.noteText ?? '').trim()

  if (!noteText) {
    return NextResponse.json({ error: 'Note text is required' }, { status: 400 })
  }
  if (noteText.length > 2000) {
    return NextResponse.json({ error: 'Note text must be 2000 characters or less' }, { status: 400 })
  }

  const note = await createCustomerNote(customerId, user.id, noteText)
  return NextResponse.json(note, { status: 201 })
}
