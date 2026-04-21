import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { MANAGER_ROLES } from '@/types/database'
import { getServiceTickets } from '@/lib/db/service-tickets'
import type { ServiceTicketStatus, ServicePriority, ServiceTicketType, ServiceBillingType } from '@/types/service-tickets'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    const { customer_id, ticket_type, problem_description } = body
    if (!customer_id || !ticket_type || !problem_description) {
      return NextResponse.json(
        { error: 'customer_id, ticket_type, and problem_description are required' },
        { status: 400 }
      )
    }

    if (!['inside', 'outside'].includes(ticket_type)) {
      return NextResponse.json({ error: 'ticket_type must be inside or outside' }, { status: 400 })
    }

    if (body.billing_type && !['non_warranty', 'warranty', 'partial_warranty'].includes(body.billing_type)) {
      return NextResponse.json({ error: 'Invalid billing_type' }, { status: 400 })
    }

    if (body.priority && !['emergency', 'standard', 'low'].includes(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }

    const supabase = await createClient()

    const insertData = {
      customer_id: parseInt(customer_id),
      equipment_id: body.equipment_id || null,
      assigned_technician_id: body.assigned_technician_id || null,
      created_by_id: user.id,
      ticket_type,
      billing_type: body.billing_type || 'non_warranty',
      priority: body.priority || 'standard',
      problem_description,
      contact_name: body.contact_name || null,
      contact_email: body.contact_email || null,
      contact_phone: body.contact_phone || null,
      service_address: body.service_address || null,
      service_city: body.service_city || null,
      service_state: body.service_state || null,
      service_zip: body.service_zip || null,
      equipment_make: body.equipment_make || null,
      equipment_model: body.equipment_model || null,
      equipment_serial_number: body.equipment_serial_number || null,
    }

    const { data, error } = await supabase
      .from('service_tickets')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('service-tickets POST error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error('service-tickets POST error:', err)
    return NextResponse.json({ error: 'Failed to create service ticket' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    const filters: {
      status?: ServiceTicketStatus
      technicianId?: string
      customerId?: number
      priority?: ServicePriority
      ticketType?: ServiceTicketType
      billingType?: ServiceBillingType
      waitingOnParts?: boolean
    } = {}

    if (searchParams.get('status')) filters.status = searchParams.get('status') as ServiceTicketStatus
    if (searchParams.get('technicianId')) filters.technicianId = searchParams.get('technicianId')!
    if (searchParams.get('customerId')) filters.customerId = parseInt(searchParams.get('customerId')!)
    if (searchParams.get('priority')) filters.priority = searchParams.get('priority') as ServicePriority
    if (searchParams.get('ticketType')) filters.ticketType = searchParams.get('ticketType') as ServiceTicketType
    if (searchParams.get('billingType')) filters.billingType = searchParams.get('billingType') as ServiceBillingType
    if (searchParams.get('waitingOnParts') === 'true') filters.waitingOnParts = true

    // Techs only see their own tickets (RLS enforces this too, but filter for clarity)
    if (isTechnician(user.role)) {
      filters.technicianId = user.id
    }

    const tickets = await getServiceTickets(filters)
    return NextResponse.json(tickets)
  } catch (err) {
    console.error('service-tickets GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch service tickets' }, { status: 500 })
  }
}
