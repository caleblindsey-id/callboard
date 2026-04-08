import { getEquipment } from '@/lib/db/equipment'
import { requireRole } from '@/lib/auth'
import EquipmentList from './EquipmentList'

export default async function EquipmentPage() {
  await requireRole('manager', 'coordinator')
  const equipment = await getEquipment()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Equipment</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage customer equipment and PM schedules
        </p>
      </div>
      <EquipmentList equipment={equipment} />
    </div>
  )
}
