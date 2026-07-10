import { getInactiveEquipmentProspects } from '@/lib/db/equipment'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PageHeader from '@/components/ui/PageHeader'
import ProspectList from './ProspectList'

export default async function ProspectsPage() {
  await requireRole(...MANAGER_ROLES)
  const prospects = await getInactiveEquipmentProspects()

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Prospects" subtitle="Inactive equipment — potential re-engagement opportunities" />
      <ProspectList prospects={prospects} />
    </div>
  )
}
