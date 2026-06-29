import { Suspense } from 'react'
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
import { getOpenWorkCounts, getMtdRevenue } from '@/lib/db/dashboard-metrics'
import { redirect } from 'next/navigation'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import SyncStatusBanner from '@/components/SyncStatusBanner'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import TechDashboard from '@/components/dashboard/TechDashboard'
import KpiSection from '@/components/dashboard/sections/KpiSection'
import AlertsSection from '@/components/dashboard/sections/AlertsSection'
import PmStatusSection from '@/components/dashboard/sections/PmStatusSection'
import ServiceStatusSection from '@/components/dashboard/sections/ServiceStatusSection'
import PartsPipelineSection from '@/components/dashboard/sections/PartsPipelineSection'
import MoneySection from '@/components/dashboard/sections/MoneySection'
import ScheduleSection from '@/components/dashboard/sections/ScheduleSection'
import ReadyToBillSection from '@/components/dashboard/sections/ReadyToBillSection'
import ReadyForPickupSection from '@/components/dashboard/sections/ReadyForPickupSection'
import EstimateFollowUpSection from '@/components/dashboard/sections/EstimateFollowUpSection'
import DeclinedEstimatesSection from '@/components/dashboard/sections/DeclinedEstimatesSection'
import WarrantyClaimsSection from '@/components/dashboard/sections/WarrantyClaimsSection'
import PoNeededSection from '@/components/dashboard/sections/PoNeededSection'
import {
  KpiSkeleton,
  AlertsSkeleton,
  StatusGridSkeleton,
  PartsSkeleton,
  MoneySkeleton,
  ScheduleSkeleton,
  ReadyToBillSkeleton,
} from '@/components/dashboard/sections/skeletons'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const monthName = now.toLocaleString('default', { month: 'long' })

  const user = await getCurrentUser()
  // Defense in depth: an authenticated session with no profile row should never
  // reach the dashboard (the proxy already denies it). If it somehow does, send
  // it to login rather than silently rendering the full manager view.
  if (!user) redirect('/login')
  const isTech = isTechnician(user.role)

  // ---- Tech view: lighter data load, dedicated layout ----
  if (isTech && user) {
    const params = await searchParams
    const [
      tickets,
      overdueCount,
      skipRequestedCount,
      partsOnOrder,
      partsReadyForPickup,
      openWork,
      mtd,
      serviceCounts,
      serviceTickets,
      poNeededCount,
    ] = await Promise.all([
      getTickets({ month, year, technicianId: user.id }),
      getOverdueTicketCount({ technicianId: user.id }),
      getSkipRequestedCount({ technicianId: user.id }),
      getPartsOnOrderCount(user.id),
      getPartsReadyForPickupCount(user.id),
      getOpenWorkCounts(user.id),
      getMtdRevenue(user.id),
      getServiceTicketCounts(user.id),
      getServiceTickets({ technicianId: user.id }),
      getPoNeededCount(user.id),
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
        openWorkTotal={openWork.total}
        mtdRevenue={mtd.total}
        mtdPmRevenue={mtd.pm}
        mtdServiceRevenue={mtd.service}
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
        initialTab={params.tab ?? ''}
      />
    )
  }

  // ---- Manager view: streamed sections ----
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {monthName} {year} overview
        </p>
      </div>

      <Suspense fallback={<KpiSkeleton />}>
        <KpiSection />
      </Suspense>

      <Suspense fallback={<AlertsSkeleton />}>
        <AlertsSection />
      </Suspense>

      <Suspense fallback={<StatusGridSkeleton />}>
        <PmStatusSection month={month} year={year} monthName={monthName} />
      </Suspense>

      <Suspense fallback={<StatusGridSkeleton />}>
        <ServiceStatusSection />
      </Suspense>

      <Suspense fallback={<PartsSkeleton />}>
        <PartsPipelineSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <EstimateFollowUpSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <DeclinedEstimatesSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <WarrantyClaimsSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <PoNeededSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <ReadyToBillSection />
      </Suspense>

      <Suspense fallback={<ReadyToBillSkeleton />}>
        <ReadyForPickupSection />
      </Suspense>

      <Suspense fallback={<MoneySkeleton />}>
        <MoneySection />
      </Suspense>

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleSection month={month} year={year} monthName={monthName} />
      </Suspense>

      <section>
        <ZoneHeader label="Sync Status" />
        <Suspense
          fallback={
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="h-5 w-40 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          }
        >
          <SyncStatusBanner />
        </Suspense>
      </section>
    </div>
  )
}
