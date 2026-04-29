import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { calcNextServiceMonth } from '@/lib/utils/schedule'
import TechEquipmentList from './TechEquipmentList'

export type TechEquipmentItem = {
  id: string
  make: string | null
  model: string | null
  serial_number: string | null
  location_on_site: string | null
  active: boolean
  customers: { name: string } | null
  lastServiceDate: string | null
  nextServiceDate: string | null
}

export default async function MyEquipmentPage() {
  const user = await requireRole('technician', ...MANAGER_ROLES)
  const supabase = await createClient()

  // Distinct equipment IDs the user has been assigned to a ticket on (PM + service).
  const [pmRes, svcRes] = await Promise.all([
    supabase
      .from('pm_tickets')
      .select('equipment_id')
      .eq('assigned_technician_id', user.id)
      .not('equipment_id', 'is', null),
    supabase
      .from('service_tickets')
      .select('equipment_id')
      .eq('assigned_technician_id', user.id)
      .not('equipment_id', 'is', null),
  ])

  const equipmentIds = Array.from(
    new Set([
      ...(pmRes.data ?? []).map((r) => r.equipment_id as string),
      ...(svcRes.data ?? []).map((r) => r.equipment_id as string),
    ])
  )

  if (equipmentIds.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Equipment</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Equipment you&apos;ve been assigned to
          </p>
        </div>
        <TechEquipmentList equipment={[]} />
      </div>
    )
  }

  const { data: equipment } = await supabase
    .from('equipment')
    .select(`
      id, make, model, serial_number, location_on_site, active,
      customers(name),
      pm_schedules(interval_months, anchor_month, active)
    `)
    .in('id', equipmentIds)
    .eq('active', true)

  const eqRows = (equipment ?? []) as unknown as Array<{
    id: string
    make: string | null
    model: string | null
    serial_number: string | null
    location_on_site: string | null
    active: boolean
    customers: { name: string } | null
    pm_schedules: { interval_months: number; anchor_month: number; active: boolean }[]
  }>

  // Last service + next service computation — mirrors src/app/equipment/page.tsx
  const lastServiceMap = new Map<string, string>()
  const ticketsByEquipment = new Map<string, Set<string>>()

  const { data: tickets } = await supabase
    .from('pm_tickets')
    .select('equipment_id, completed_date, status, month, year')
    .in('equipment_id', equipmentIds)
    .is('deleted_at', null)
    .order('completed_date', { ascending: false })

  for (const t of tickets ?? []) {
    if (!t.equipment_id) continue
    if (
      (t.status === 'completed' || t.status === 'billed') &&
      t.completed_date &&
      !lastServiceMap.has(t.equipment_id)
    ) {
      lastServiceMap.set(t.equipment_id, t.completed_date)
    }
    if (t.status !== 'skipped' && t.month && t.year) {
      if (!ticketsByEquipment.has(t.equipment_id)) {
        ticketsByEquipment.set(t.equipment_id, new Set())
      }
      ticketsByEquipment.get(t.equipment_id)!.add(`${t.year}-${t.month}`)
    }
  }

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const enriched: TechEquipmentItem[] = eqRows.map((e) => {
    const activeSchedule = e.pm_schedules?.find((s) => s.active)
    let nextServiceDate: string | null = null
    if (activeSchedule) {
      const existingKeys = ticketsByEquipment.get(e.id) ?? new Set<string>()
      const next = calcNextServiceMonth(
        activeSchedule.interval_months,
        activeSchedule.anchor_month,
        currentMonth,
        currentYear,
        existingKeys
      )
      if (next) {
        nextServiceDate = `${next.year}-${String(next.month).padStart(2, '0')}`
      }
    }
    return {
      id: e.id,
      make: e.make,
      model: e.model,
      serial_number: e.serial_number,
      location_on_site: e.location_on_site,
      active: e.active,
      customers: e.customers,
      lastServiceDate: lastServiceMap.get(e.id) ?? null,
      nextServiceDate,
    }
  })

  // Sort: overdue/due first (next service ascending, nulls last), then customer name.
  enriched.sort((a, b) => {
    if (a.nextServiceDate && b.nextServiceDate) {
      if (a.nextServiceDate !== b.nextServiceDate) {
        return a.nextServiceDate.localeCompare(b.nextServiceDate)
      }
    } else if (a.nextServiceDate) {
      return -1
    } else if (b.nextServiceDate) {
      return 1
    }
    return (a.customers?.name ?? '').localeCompare(b.customers?.name ?? '')
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Equipment</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Equipment you&apos;ve been assigned to
        </p>
      </div>
      <TechEquipmentList equipment={enriched} />
    </div>
  )
}
