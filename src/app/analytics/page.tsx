import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getTeamAnalytics, stripCostFieldsForCoordinator } from '@/lib/db/analytics'
import { parseAnalyticsParams } from '@/lib/analytics-period'
import AnalyticsOverview from './AnalyticsOverview'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string; type?: string }>
}) {
  const user = await requireRole(...MANAGER_ROLES)

  // Seeded from the URL so a shared/bookmarked period renders server-side.
  // Anything malformed falls back to the current month.
  const { periodType, date, ticketType } = parseAnalyticsParams(await searchParams)
  const raw = await getTeamAnalytics(periodType, date, ticketType)
  // Strip compensation-derived fields when the viewer is a coordinator —
  // mirrors the API route shaping so SSR data matches subsequent fetches.
  const data = stripCostFieldsForCoordinator(raw, user.role!)

  return <AnalyticsOverview initialData={data} />
}
