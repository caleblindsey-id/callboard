import { requireRole } from '@/lib/auth'
import { getTeamAnalytics } from '@/lib/db/analytics'
import AnalyticsOverview from './AnalyticsOverview'

export default async function AnalyticsPage() {
  await requireRole('manager', 'coordinator')

  const today = new Date().toISOString().split('T')[0]
  const data = await getTeamAnalytics('monthly', today)

  return (
    <div className="space-y-6">
      <AnalyticsOverview initialData={data} />
    </div>
  )
}
