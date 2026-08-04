import { notFound } from 'next/navigation'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getTechnicianAnalytics, stripTechCostFieldsForCoordinator } from '@/lib/db/analytics'
import { parseAnalyticsParams } from '@/lib/analytics-period'
import TechnicianProfile from './TechnicianProfile'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function TechnicianAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ technicianId: string }>
  searchParams: Promise<{ period?: string; date?: string; type?: string }>
}) {
  const user = await requireRole(...MANAGER_ROLES)

  const { technicianId } = await params
  // Validate UUID at the SSR boundary — Supabase rejects non-UUIDs with a
  // 500-style query error otherwise.
  if (!UUID_RE.test(technicianId)) {
    notFound()
  }

  // Seeded from the URL so the period carries over from the leaderboard link.
  const { periodType, date, ticketType } = parseAnalyticsParams(await searchParams)
  const raw = await getTechnicianAnalytics(technicianId, periodType, date, ticketType)
  const data = stripTechCostFieldsForCoordinator(raw, user.role!)

  return <TechnicianProfile initialData={data} />
}
