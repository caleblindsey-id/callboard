import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { TechLeadFrequency, TechLeadInsert } from '@/types/database'

const VALID_FREQUENCIES: TechLeadFrequency[] = [
  'monthly',
  'bi-monthly',
  'quarterly',
  'semi-annual',
  'annual',
]

type CreateBody = {
  customer_id?: number | null
  customer_name_text?: string | null
  equipment_description: string
  proposed_pm_frequency?: TechLeadFrequency | null
  notes?: string | null
}

// POST /api/tech-leads — tech submits a lead. Office users (super_admin/manager)
// can also submit on behalf of a tech, but the normal flow is the tech filing
// from /my-leads. Techs submit as themselves (submitted_by = auth.uid()).
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const isStaff = MANAGER_ROLES.includes(user.role)
    const isTech = user.role === 'technician'
    if (!isStaff && !isTech) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as CreateBody
    const {
      customer_id = null,
      customer_name_text = null,
      equipment_description,
      proposed_pm_frequency = null,
      notes = null,
    } = body

    if (!equipment_description?.trim()) {
      return NextResponse.json(
        { error: 'Equipment description is required.' },
        { status: 400 }
      )
    }
    const hasExisting = typeof customer_id === 'number' && customer_id > 0
    const hasFreeText = !!customer_name_text?.trim()
    if (hasExisting === hasFreeText) {
      return NextResponse.json(
        { error: 'Provide either an existing customer or a new customer name — not both, not neither.' },
        { status: 400 }
      )
    }
    if (proposed_pm_frequency && !VALID_FREQUENCIES.includes(proposed_pm_frequency)) {
      return NextResponse.json(
        { error: 'Invalid proposed_pm_frequency.' },
        { status: 400 }
      )
    }

    const insert: TechLeadInsert = {
      submitted_by: user.id,
      equipment_description: equipment_description.trim(),
      customer_id: hasExisting ? customer_id : null,
      customer_name_text: hasFreeText ? customer_name_text!.trim() : null,
      proposed_pm_frequency: proposed_pm_frequency ?? null,
      notes: notes?.trim() || null,
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('tech_leads')
      .insert(insert)
      .select('id')
      .single()
    if (error) {
      console.error('tech-leads create error:', error)
      return NextResponse.json({ error: 'Failed to submit lead.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('tech-leads POST error:', err)
    return NextResponse.json({ error: 'Failed to submit lead.' }, { status: 500 })
  }
}
