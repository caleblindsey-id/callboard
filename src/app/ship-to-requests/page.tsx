import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import {
  getShipToRequestsByStatus,
  getShipToLocationsForCustomers,
  getShipToLocationsByIds,
} from '@/lib/db/ship-to-requests'
import PageHeader from '@/components/ui/PageHeader'
import ShipToRequestsClient from './ShipToRequestsClient'

export const dynamic = 'force-dynamic'

export default async function ShipToRequestsPage() {
  await requireRole(...MANAGER_ROLES)

  const [pending, resolved, dismissed] = await Promise.all([
    getShipToRequestsByStatus('pending'),
    getShipToRequestsByStatus('resolved'),
    getShipToRequestsByStatus('dismissed'),
  ])

  // Two different needs, two different queries. Match scoring needs every location
  // a pending customer has; the resolved tab needs only the ones actually linked.
  const [candidates, linked] = await Promise.all([
    getShipToLocationsForCustomers(pending.map((r) => r.customer_id)),
    getShipToLocationsByIds(
      resolved
        .map((r) => r.resolved_ship_to_id)
        .filter((id): id is number => typeof id === 'number')
    ),
  ])

  const byId = new Map(candidates.map((l) => [l.id, l]))
  for (const l of linked) byId.set(l.id, l)

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Ship-To Requests"
        subtitle="Delivery addresses techs need that are not in Synergy yet. Add the location in Synergy, then record it here so the tech can use it today instead of waiting for the overnight sync."
      />
      <ShipToRequestsClient
        pending={pending}
        resolved={resolved}
        dismissed={dismissed}
        locations={[...byId.values()]}
      />
    </div>
  )
}
