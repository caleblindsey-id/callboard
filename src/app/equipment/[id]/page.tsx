import { getEquipmentDetail, getEquipmentServiceHistory } from '@/lib/db/equipment'
import { getUsers } from '@/lib/db/users'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import EquipmentForm from './EquipmentForm'
import ScheduleSection from './ScheduleSection'
import DefaultProductsSection from './DefaultProductsSection'
import ServiceHistory from '@/components/ServiceHistory'
import EquipmentNotes from '@/components/EquipmentNotes'

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole('manager', 'coordinator', 'technician')
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

  const serviceHistory = await getEquipmentServiceHistory(id)
  const activeSchedule = equipment.pm_schedules.find((s) => s.active)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={isTech ? '/tickets' : '/equipment'}
          className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
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

      <ServiceHistory tickets={serviceHistory} showBilling={showBilling} />

      <EquipmentNotes equipmentId={equipment.id} />
    </div>
  )
}
