import { getEquipment } from '@/lib/db/equipment'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { calcNextServiceMonth } from '@/lib/utils/schedule'
import PageHeader from '@/components/ui/PageHeader'
import EquipmentList from './EquipmentList'
import EquipmentActions from './EquipmentActions'

export type EquipmentListItem = Awaited<ReturnType<typeof getEquipment>>[number] & {
  lastServiceDate: string | null
  nextServiceDate: string | null
}

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; active?: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const params = await searchParams
  const equipment = await getEquipment()

  const equipmentIds = equipment.map((e) => e.id)
  const lastServiceMap = new Map<string, string>()
  // Map of equipmentId -> Set of "year-month" keys for existing tickets
  const ticketsByEquipment = new Map<string, Set<string>>()

  if (equipmentIds.length > 0) {
    const supabase = await createClient()

    // Batch-fetch all pm_tickets for these equipment IDs
    const { data: tickets } = await supabase
      .from('pm_tickets')
      .select('equipment_id, completed_date, status, month, year')
      .in('equipment_id', equipmentIds)
      .is('deleted_at', null)
      .order('completed_date', { ascending: false })

    for (const t of tickets ?? []) {
      if (!t.equipment_id) continue

      // Build last service date from completed/billed tickets
      if ((t.status === 'completed' || t.status === 'billed') && t.completed_date && !lastServiceMap.has(t.equipment_id)) {
        lastServiceMap.set(t.equipment_id, t.completed_date)
      }

      // Track which month/year combos already have a ticket (any status except skipped)
      if (t.status !== 'skipped' && t.month && t.year) {
        if (!ticketsByEquipment.has(t.equipment_id)) {
          ticketsByEquipment.set(t.equipment_id, new Set())
        }
        ticketsByEquipment.get(t.equipment_id)!.add(`${t.year}-${t.month}`)
      }
    }
  }

  // Calculate next service dates from schedules
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const enriched: EquipmentListItem[] = equipment.map((e) => {
    const activeSchedule = e.pm_schedules?.find((s) => s.active)
    let nextServiceDate: string | null = null
    if (activeSchedule) {
      const existingKeys = ticketsByEquipment.get(e.id) ?? new Set()
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
      ...e,
      lastServiceDate: lastServiceMap.get(e.id) ?? null,
      nextServiceDate,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Equipment"
        subtitle="Manage customer equipment and PM schedules"
        actions={<EquipmentActions />}
      />
      <EquipmentList
        equipment={enriched}
        initialFilters={{ q: params.q ?? '', active: params.active === 'inactive' ? 'inactive' : '' }}
      />
    </div>
  )
}
