import {
  getTickets,
  getOverdueTicketCount,
  getSkipRequestedCount,
} from '@/lib/db/tickets'
import {
  getPartsOnOrderCount,
  getPartsReadyForPickupCount,
  getServiceTicketCounts,
  getServiceTickets,
  getPoNeededCount,
} from '@/lib/db/service-tickets'
import TechDashboard from '@/components/dashboard/TechDashboard'

type Props = {
  userId: string
  month: number
  year: number
  monthName: string
  initialTab: string
}

// Tech "My Day" tabbed work area (Overview / PM / Service). The overview panel
// and the tab badges draw on every query here, so this streams as one chunk.
export default async function TechWorkSection({
  userId,
  month,
  year,
  monthName,
  initialTab,
}: Props) {
  const [
    tickets,
    overdueCount,
    skipRequestedCount,
    partsOnOrder,
    partsReadyForPickup,
    serviceCounts,
    serviceTickets,
    poNeededCount,
  ] = await Promise.all([
    getTickets({ month, year, technicianId: userId }),
    getOverdueTicketCount({ technicianId: userId }),
    getSkipRequestedCount({ technicianId: userId }),
    getPartsOnOrderCount(userId),
    getPartsReadyForPickupCount(userId),
    getServiceTicketCounts(userId),
    getServiceTickets({ technicianId: userId }),
    getPoNeededCount(userId),
  ])

  // PM "My Work" breakdown (this month).
  const myCounts = { assigned: 0, in_progress: 0, completed: 0 }
  for (const t of tickets) {
    if (t.status === 'assigned') myCounts.assigned++
    if (t.status === 'in_progress') myCounts.in_progress++
    if (t.status === 'completed') myCounts.completed++
  }

  const upcoming = tickets.filter(
    (t) => t.status === 'assigned' || t.status === 'in_progress'
  )

  // Service worklist — the actively-worked states a tech still owns.
  const SERVICE_ACTIVE = ['open', 'estimated', 'approved', 'in_progress']
  const serviceWork = serviceTickets.filter((t) =>
    SERVICE_ACTIVE.includes(t.status)
  )

  // "Needs my action" service signals that aren't obvious from status alone.
  const TERMINAL = ['completed', 'billed', 'declined', 'canceled']
  const revisionRequestedCount = serviceTickets.filter(
    (t) => t.request_info_note?.trim() && !TERMINAL.includes(t.status)
  ).length
  // Linked unit not yet verified, blocking parts/estimate on cleared-to-work tickets.
  const equipmentToVerifyCount = serviceTickets.filter(
    (t) =>
      (t.status === 'approved' || t.status === 'in_progress') &&
      t.equipment != null &&
      !t.equipment.details_verified_at
  ).length

  return (
    <TechDashboard
      monthName={monthName}
      month={month}
      year={year}
      overdueCount={overdueCount}
      skipRequestedCount={skipRequestedCount}
      assignedCount={myCounts.assigned}
      inProgressCount={myCounts.in_progress}
      completedCount={myCounts.completed}
      partsOnOrder={partsOnOrder}
      partsReady={partsReadyForPickup}
      upcoming={upcoming}
      serviceOpenCount={serviceCounts.open ?? 0}
      serviceEstimatedCount={serviceCounts.estimated ?? 0}
      serviceApprovedCount={serviceCounts.approved ?? 0}
      serviceInProgressCount={serviceCounts.in_progress ?? 0}
      serviceWork={serviceWork}
      revisionRequestedCount={revisionRequestedCount}
      equipmentToVerifyCount={equipmentToVerifyCount}
      poNeededCount={poNeededCount}
      initialTab={initialTab}
    />
  )
}
