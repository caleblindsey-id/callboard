import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_FIELDS = ['active', 'show_pricing_on_pm_pdf'] as const
type AllowedField = (typeof ALLOWED_FIELDS)[number]

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const body = (await request.json()) as Record<string, unknown>
    const update: Partial<Record<AllowedField, boolean>> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        if (typeof body[field] !== 'boolean') {
          return NextResponse.json(
            { error: `Field '${field}' must be a boolean.` },
            { status: 400 }
          )
        }
        update[field] = body[field] as boolean
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('customers')
      .update(update)
      .eq('id', customerId)

    if (error) {
      console.error('customers PATCH write error:', error)
      return NextResponse.json({ error: 'Failed to update customer.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('customers PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update customer.' }, { status: 500 })
  }
}
