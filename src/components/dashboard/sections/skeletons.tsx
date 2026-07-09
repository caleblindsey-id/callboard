function Box({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-100 dark:bg-gray-700 rounded animate-pulse ${className}`} />
}

function Card({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 ${className}`}
    >
      <Box className="h-3 w-20 mb-3" />
      <Box className="h-7 w-16" />
    </div>
  )
}

function ZoneSkeleton() {
  return <Box className="h-3 w-32 mb-3" />
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Card />
      <Card />
      <Card />
      <Card />
      <Card />
    </div>
  )
}

export function AlertsSkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card />
        <Card />
      </div>
    </section>
  )
}

export function StatusGridSkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        <Card />
        <Card />
        <Card />
        <Card />
        <Card />
      </div>
    </section>
  )
}

export function PartsSkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card />
        <Card />
        <Card />
        <Card />
      </div>
    </section>
  )
}

export function MoneySkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        <Card className="h-32" />
        <Card className="h-32" />
        <Card className="md:col-span-2 h-20" />
      </div>
    </section>
  )
}

// Matches QueueStatCard's row layout (icon+title/subtitle left, count+chevron
// right) so the six queue-grid cells don't reflow when data streams in.
export function QueueStatCardSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Box className="h-4 w-32 mb-2" />
          <Box className="h-3 w-24" />
        </div>
        <Box className="h-7 w-10 shrink-0" />
      </div>
    </div>
  )
}

export function TechKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card className="h-[104px]" />
      <Card className="h-[104px]" />
    </div>
  )
}

export function TechWorkSkeleton() {
  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-2 flex gap-4">
        <Box className="h-6 w-24" />
        <Box className="h-6 w-16" />
        <Box className="h-6 w-20" />
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-4 py-3 space-y-2">
          <Box className="h-4 w-40" />
          <Box className="h-3 w-56" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <Box className="h-4 w-48" />
          <Box className="h-3 w-44" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <Box className="h-4 w-36" />
          <Box className="h-3 w-52" />
        </div>
      </div>
    </div>
  )
}

export function ScheduleSkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <Box className="h-7 w-full max-w-md" />
      </div>
    </section>
  )
}
