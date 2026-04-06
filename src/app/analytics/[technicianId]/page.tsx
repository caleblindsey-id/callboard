import { requireRole } from '@/lib/auth'
import { getTechnicianAnalytics } from '@/lib/db/analytics'
import TechnicianProfile from './TechnicianProfile'

export default async function TechnicianAnalyticsPage({
  params,
}: {
  params: Promise<{ technicianId: string }>
}) {
  await requireRole('manager', 'coordinator')

  const { technicianId } = await params
  const today = new Date().toISOString().split('T')[0]
  const data = await getTechnicianAnalytics(technicianId, 'monthly', today)

  return (
    <div className="space-y-6">
      <TechnicianProfile initialData={data} />
    </div>
  )
}
