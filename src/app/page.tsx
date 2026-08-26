import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import SyncStatusBanner from '@/components/SyncStatusBanner'
import DeniedBanner from '@/components/DeniedBanner'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import ZoneErrorBoundary from '@/components/dashboard/ZoneErrorBoundary'
import TechKpiSection from '@/components/dashboard/sections/TechKpiSection'
import TechWorkSection from '@/components/dashboard/sections/TechWorkSection'
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
import BelowReorderPointSection from '@/components/dashboard/sections/BelowReorderPointSection'
import {
  KpiSkeleton,
  AlertsSkeleton,
  StatusGridSkeleton,
  PartsSkeleton,
  MoneySkeleton,
  ScheduleSkeleton,
  QueueStatCardSkeleton,
  TechKpiSkeleton,
  TechWorkSkeleton,
} from '@/components/dashboard/sections/skeletons'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string }>
}) {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const monthName = now.toLocaleString('default', { month: 'long' })

  const params = await searchParams
  const showDenied = params.error === 'denied'

  const user = await getCurrentUser()
  // Defense in depth: an authenticated session with no profile row should never
  // reach the dashboard (the proxy already denies it). If it somehow does, send
  // it to login rather than silently rendering the full manager view.
  if (!user) redirect('/login')
  const isTech = isTechnician(user.role)

  // ---- Tech view: static shell paints immediately, data streams in ----
  if (isTech && user) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">My Day</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {monthName} {year}
          </p>
        </div>

        {showDenied && <DeniedBanner />}

        <ZoneErrorBoundary>
          <Suspense fallback={<TechKpiSkeleton />}>
            <TechKpiSection userId={user.id} />
          </Suspense>
        </ZoneErrorBoundary>

        <ZoneErrorBoundary>
          <Suspense fallback={<TechWorkSkeleton />}>
            <TechWorkSection
              userId={user.id}
              month={month}
              year={year}
              monthName={monthName}
              initialTab={params.tab ?? ''}
            />
          </Suspense>
        </ZoneErrorBoundary>
      </div>
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

      {showDenied && <DeniedBanner />}

      <ZoneErrorBoundary>
        <Suspense fallback={<KpiSkeleton />}>
          <KpiSection />
        </Suspense>
      </ZoneErrorBoundary>

      <ZoneErrorBoundary>
        <Suspense fallback={<AlertsSkeleton />}>
          <AlertsSection />
        </Suspense>
      </ZoneErrorBoundary>

      <ZoneErrorBoundary>
        <Suspense fallback={<StatusGridSkeleton />}>
          <PmStatusSection month={month} year={year} monthName={monthName} />
        </Suspense>
      </ZoneErrorBoundary>

      <ZoneErrorBoundary>
        <Suspense fallback={<StatusGridSkeleton />}>
          <ServiceStatusSection />
        </Suspense>
      </ZoneErrorBoundary>

      <ZoneErrorBoundary>
        <Suspense fallback={<PartsSkeleton />}>
          <PartsPipelineSection />
        </Suspense>
      </ZoneErrorBoundary>

      <section>
        <ZoneHeader label="Queues" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <EstimateFollowUpSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <DeclinedEstimatesSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <WarrantyClaimsSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <PoNeededSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <BelowReorderPointSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <ReadyToBillSection />
            </Suspense>
          </ZoneErrorBoundary>

          <ZoneErrorBoundary>
            <Suspense fallback={<QueueStatCardSkeleton />}>
              <ReadyForPickupSection />
            </Suspense>
          </ZoneErrorBoundary>
        </div>
      </section>

      <ZoneErrorBoundary>
        <Suspense fallback={<MoneySkeleton />}>
          <MoneySection />
        </Suspense>
      </ZoneErrorBoundary>

      <ZoneErrorBoundary>
        <Suspense fallback={<ScheduleSkeleton />}>
          <ScheduleSection month={month} year={year} monthName={monthName} />
        </Suspense>
      </ZoneErrorBoundary>

      <section>
        <ZoneHeader label="Sync Status" />
        <ZoneErrorBoundary>
          <Suspense
            fallback={
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="h-5 w-40 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            }
          >
            <SyncStatusBanner />
          </Suspense>
        </ZoneErrorBoundary>
      </section>
    </div>
  )
}
