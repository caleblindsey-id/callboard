import { getEquipmentDetail, getEquipmentServiceHistory, getEquipmentEstimateHistory } from '@/lib/db/equipment'
import { getServiceTicketsForEquipment } from '@/lib/db/service-tickets'
import { getUsers } from '@/lib/db/users'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import BackButton from '@/components/BackButton'
import EquipmentForm from './EquipmentForm'
import ScheduleSection from './ScheduleSection'
import DefaultProductsSection from './DefaultProductsSection'
import DefaultProductsReadOnly from './DefaultProductsReadOnly'
import ServiceHistory from '@/components/ServiceHistory'
import EstimateHistory from '@/components/EstimateHistory'
import EquipmentNotes from '@/components/EquipmentNotes'
import AuditHistorySection from '@/components/AuditHistorySection'
import { pmTicketToHistoryItem } from '@/types/service-tickets'
import type { ServiceHistoryItem } from '@/types/service-tickets'

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(...MANAGER_ROLES, 'technician')
  const isTech = user.role === 'technician'
  const showBilling = !isTech
  const { id } = await params
  const [equipment, users] = await Promise.all([
    getEquipmentDetail(id),
    getUsers(true),
  ])

  const supabase = await createClient()
  const { data: shipToLocations } = equipment?.customer_id
    ? await supabase
        .from('ship_to_locations')
        .select('id, name, city')
        .eq('customer_id', equipment.customer_id)
        .order('name')
    : { data: [] }

  if (!equipment) notFound()

  const [pmHistory, svcHistory, estimateHistory] = await Promise.all([
    getEquipmentServiceHistory(id),
    getServiceTicketsForEquipment(id),
    getEquipmentEstimateHistory(id),
  ])

  // Merge PM + service tickets into unified timeline
  const pmItems = pmHistory.map(pmTicketToHistoryItem)
  const svcItems: ServiceHistoryItem[] = svcHistory.map((t) => ({
    id: t.id,
    type: 'service' as const,
    work_order_number: t.work_order_number,
    status: t.status,
    date: t.completed_at,
    hours_worked: t.hours_worked,
    parts_count: Array.isArray(t.parts_used) ? t.parts_used.length : 0,
    billing_amount: t.billing_amount,
    completion_notes: t.completion_notes,
    technician_name: t.assigned_technician?.name ?? null,
    problem_description: t.problem_description,
    ticket_type: t.ticket_type,
    billing_type: t.billing_type,
  }))
  const allHistory = [...pmItems, ...svcItems].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return db - da
  })

  const activeSchedule = equipment.pm_schedules.find((s) => s.active)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref={isTech ? '/tickets' : '/equipment'} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {[equipment.make, equipment.model].filter(Boolean).join(' ') || 'Equipment'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {equipment.customers?.name ?? 'No customer'} — {equipment.serial_number ?? 'No serial'}
          </p>
        </div>
      </div>

      <EquipmentForm equipment={equipment} users={users} shipToLocations={shipToLocations ?? []} isTech={isTech} />

      {!isTech && (
        <ScheduleSection
          equipmentId={equipment.id}
          schedule={activeSchedule ?? null}
        />
      )}

      {!isTech && (
        <DefaultProductsSection
          equipmentId={equipment.id}
          initialProducts={equipment.default_products ?? []}
        />
      )}

      {isTech && (
        <DefaultProductsReadOnly products={equipment.default_products ?? []} />
      )}

      <ServiceHistory items={allHistory} showBilling={showBilling} />

      <EstimateHistory items={estimateHistory} />

      <EquipmentNotes equipmentId={equipment.id} />

      <AuditHistorySection entityType="equipment" entityId={equipment.id} />
    </div>
  )
}
