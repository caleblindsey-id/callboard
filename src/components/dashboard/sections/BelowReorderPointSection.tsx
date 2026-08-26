import { AlertTriangle } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getBelowReorderPointCount } from '@/lib/db/reorder'

// Purchasing/Reorder module (migration 142) dashboard card. Gated to
// MANAGER_ROLES, not PURCHASING_ROLES — a purchasing-role user never lands on
// this dashboard (proxy.ts redirects them straight to /purchasing), and
// inv_reorder's RLS only grants SELECT to super_admin/manager/purchasing in
// the first place, so this explicit check is belt-and-suspenders against a
// stray query rather than the only thing standing between a wrong role and
// the count.
export default async function BelowReorderPointSection() {
  const user = await getCurrentUser()
  if (!user?.role || !MANAGER_ROLES.includes(user.role)) return null

  const count = await getBelowReorderPointCount()
  if (count === 0) return null

  return (
    <QueueStatCard
      href="/purchasing/new?scope=below_rop"
      icon={AlertTriangle}
      title="Below Reorder Point"
      subtitle={`${count} item${count === 1 ? '' : 's'} at or below reorder point`}
      alertSubtitle
      count={count}
    />
  )
}
