import { Suspense } from 'react'
import {
  getTickets,
  getOverdueTicketCount,
  getSkipRequestedCount,
} from '@/lib/db/tickets'
import {
  getPartsOnOrderCount,
  getPartsReadyForPickupCount,
} from '@/lib/db/service-tickets'
import { getOpenWorkCounts } from '@/lib/db/dashboard-metrics'
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
import {
  KpiSkeleton,
  AlertsSkeleton,
  StatusGridSkeleton,
  PartsSkeleton,
  MoneySkeleton,
  ScheduleSkeleton,
  ReadyToBillSkeleton,
} from '@/components/dashboard/sections/skeletons'

export default async function DashboardPage() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const monthName = now.toLocaleString('default', { month: 'long' })

  const user = await getCurrentUser()
  const isTech = isTechnician(user?.role ?? null)

  // ---- Tech view: lighter data load, dedicated layout ----
  if (isTech && user) {
    const [
      tickets,
      overdueCount,
      skipRequestedCount,
      partsOnOrder,
      partsReadyForPickup,
      openWork,
    ] = await Promise.all([
      getTickets({ month, year, technicianId: user.id }),
      getOverdueTicketCount({ technicianId: user.id }),
      getSkipRequestedCount({ technicianId: user.id }),
      getPartsOnOrderCount(user.id),
      getPartsReadyForPickupCount(user.id),
      getOpenWorkCounts(user.id),
    ])

    const myCounts = { assigned: 0, in_progress: 0, completed: 0 }
    let mtdRevenue = 0
    for (const t of tickets) {
      if (t.status === 'assigned') myCounts.assigned++
      if (t.status === 'in_progress') myCounts.in_progress++
      if (t.status === 'completed') myCounts.completed++
      if (t.status === 'completed' || t.status === 'billed') {
        mtdRevenue += t.billing_amount ?? 0
      }
    }

    const upcoming = tickets.filter(
      (t) => t.status === 'assigned' || t.status === 'in_progress'
    )

    return (
      <TechDashboard
        monthName={monthName}
        month={month}
        year={year}
        openWorkTotal={openWork.total}
        mtdRevenue={mtdRevenue}
        overdueCount={overdueCount}
        skipRequestedCount={skipRequestedCount}
        assignedCount={myCounts.assigned}
        inProgressCount={myCounts.in_progress}
        completedCount={myCounts.completed}
        partsOnOrder={partsOnOrder}
        partsReady={partsReadyForPickup}
        upcoming={upcoming}
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
