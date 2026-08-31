import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'

// Unified "Billing Chase" worklist: completed PM and service tickets missing
// any of the three things billing needs before a job can be closed out —
// a Synergy order # (not_entered), a required customer PO (po_missing), or
// (once exported) a Synergy invoice # (not_invoiced). One row per ticket,
// carrying whichever reasons apply; a ticket with none is already clean and
// is dropped. Feeds /billing/po-follow-up, its dashboard card, and the
// po_gated / not_entered_synergy morning-digest sections.

export type BillingChaseReason = 'not_entered' | 'po_missing' | 'not_invoiced'
export type BillingChaseTicketType = 'pm' | 'service'
// Presentational split for the worklist's Type column. Service tickets carry
// service_tickets.ticket_type (inside = bench/shop, outside = field); PM work is
// field work by definition and has no such column, so it is its own value.
// Deliberately SEPARATE from BillingChaseTicketType, which stays two-valued
// because the worklist branches its detail href and PATCH route off it.
export type BillingChaseWorkType = 'inside' | 'outside' | 'pm'

export type BillingChaseRow = {
  id: string
  ticketType: BillingChaseTicketType
  workType: BillingChaseWorkType
  workOrderNumber: number | null
  completedAt: string | null
  billingAmount: number | null
  poNumber: string | null
  synergyOrderNumber: string | null
  synergyInvoiceNumber: string | null
  billingExported: boolean
  poLastContactedAt: string | null
  poLastMethod: string | null
  equipmentMake: string | null
  equipmentModel: string | null
  equipment: { make: string | null; model: string | null; serial_number: string | null } | null
  customers: { id: number; name: string; account_number: string | null; po_required: boolean } | null
  assignedTechnician: { name: string } | null
  reasons: BillingChaseReason[]
}

type ChaseCustomer = { id: number; name: string; account_number: string | null; po_required: boolean } | null
type ChaseEquipment = { make: string | null; model: string | null; serial_number: string | null } | null

type ServiceChaseSource = {
  id: string
  ticket_type: 'inside' | 'outside'
  work_order_number: number | null
  completed_at: string | null
  billing_amount: number | null
  po_number: string | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  billing_exported: boolean
  po_last_contacted_at: string | null
  po_last_method: string | null
  equipment_make: string | null
  equipment_model: string | null
  customers: ChaseCustomer
  equipment: ChaseEquipment
  assigned_technician: { name: string } | null
}

type PmChaseSource = {
  id: string
  work_order_number: number | null
  completed_date: string | null
  billing_amount: number | null
  po_number: string | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  billing_exported: boolean
  po_last_contacted_at: string | null
  po_last_method: string | null
  customers: ChaseCustomer
  equipment: ChaseEquipment
  users: { name: string } | null
}

function reasonsFor(t: {
  synergy_order_number: string | null
  po_number: string | null
  synergy_invoice_number: string | null
  billing_exported: boolean
  customers: { po_required: boolean } | null
}): BillingChaseReason[] {
  const reasons: BillingChaseReason[] = []
  if (!t.synergy_order_number?.trim()) reasons.push('not_entered')
  if (t.customers?.po_required && !t.po_number?.trim()) reasons.push('po_missing')
  if (t.billing_exported === true && !t.synergy_invoice_number?.trim()) reasons.push('not_invoiced')
  return reasons
}

export async function getBillingChaseQueue(db?: DigestDb): Promise<BillingChaseRow[]> {
  const supabase = db ?? (await createClient())

  const [serviceRes, pmRes] = await Promise.all([
    supabase
      .from('service_tickets')
      .select(`
        id, ticket_type, work_order_number, completed_at, billing_amount, po_number,
        synergy_order_number, synergy_invoice_number, billing_exported,
        po_last_contacted_at, po_last_method, equipment_make, equipment_model,
        customers ( id, name, account_number, po_required ),
        equipment ( make, model, serial_number ),
        assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
      `)
      .eq('status', 'completed')
      .is('deleted_at', null),
    supabase
      .from('pm_tickets')
      .select(`
        id, work_order_number, completed_date, billing_amount, po_number,
        synergy_order_number, synergy_invoice_number, billing_exported,
        po_last_contacted_at, po_last_method,
        customers ( id, name, account_number, po_required ),
        equipment ( make, model, serial_number ),
        users!assigned_technician_id ( name )
      `)
      .eq('status', 'completed')
      .is('deleted_at', null),
  ])

  if (serviceRes.error) throw serviceRes.error
  if (pmRes.error) throw pmRes.error

  const serviceRows: BillingChaseRow[] = (
    (serviceRes.data ?? []) as unknown as ServiceChaseSource[]
  )
    .map((t): BillingChaseRow | null => {
      const reasons = reasonsFor(t)
      if (reasons.length === 0) return null
      return {
        id: t.id,
        ticketType: 'service',
        workType: t.ticket_type,
        workOrderNumber: t.work_order_number,
        completedAt: t.completed_at,
        billingAmount: t.billing_amount,
        poNumber: t.po_number,
        synergyOrderNumber: t.synergy_order_number,
        synergyInvoiceNumber: t.synergy_invoice_number,
        billingExported: t.billing_exported,
        poLastContactedAt: t.po_last_contacted_at,
        poLastMethod: t.po_last_method,
        equipmentMake: t.equipment_make,
        equipmentModel: t.equipment_model,
        equipment: t.equipment,
        customers: t.customers,
        assignedTechnician: t.assigned_technician,
        reasons,
      }
    })
    .filter((r): r is BillingChaseRow => r !== null)

  const pmRows: BillingChaseRow[] = (
    (pmRes.data ?? []) as unknown as PmChaseSource[]
  )
    .map((t): BillingChaseRow | null => {
      const reasons = reasonsFor(t)
      if (reasons.length === 0) return null
      return {
        id: t.id,
        ticketType: 'pm',
        workType: 'pm',
        workOrderNumber: t.work_order_number,
        completedAt: t.completed_date,
        billingAmount: t.billing_amount,
        poNumber: t.po_number,
        synergyOrderNumber: t.synergy_order_number,
        synergyInvoiceNumber: t.synergy_invoice_number,
        billingExported: t.billing_exported,
        poLastContactedAt: t.po_last_contacted_at,
        poLastMethod: t.po_last_method,
        equipmentMake: null,
        equipmentModel: null,
        equipment: t.equipment,
        customers: t.customers,
        assignedTechnician: t.users,
        reasons,
      }
    })
    .filter((r): r is BillingChaseRow => r !== null)

  return [...serviceRows, ...pmRows].sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length
    return (a.completedAt ?? '').localeCompare(b.completedAt ?? '')
  })
}

export type BillingChaseCounts = {
  total: number
  notEntered: number
  poMissing: number
  notInvoiced: number
}

export async function getBillingChaseCounts(db?: DigestDb): Promise<BillingChaseCounts> {
  const rows = await getBillingChaseQueue(db)
  return {
    total: rows.length,
    notEntered: rows.filter((r) => r.reasons.includes('not_entered')).length,
    poMissing: rows.filter((r) => r.reasons.includes('po_missing')).length,
    notInvoiced: rows.filter((r) => r.reasons.includes('not_invoiced')).length,
  }
}
