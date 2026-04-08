import { getInactiveEquipmentProspects } from '@/lib/db/equipment'
import { requireRole } from '@/lib/auth'
import ProspectList from './ProspectList'

export default async function ProspectsPage() {
  await requireRole('manager', 'coordinator')
  const prospects = await getInactiveEquipmentProspects()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Prospects</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Inactive equipment — potential re-engagement opportunities
        </p>
      </div>
      <ProspectList prospects={prospects} />
    </div>
  )
}
