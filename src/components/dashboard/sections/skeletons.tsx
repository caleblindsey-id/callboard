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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
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

export function ReadyToBillSkeleton() {
  return (
    <section>
      <ZoneSkeleton />
      <Card className="h-20" />
    </section>
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
