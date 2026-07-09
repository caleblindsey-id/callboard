/**
 * Content-shaped loading placeholders — use in place of a blank/frozen page or
 * a bare "Loading..." string while a server-data page or section is fetching
 * (standard-draft dimension 11). Pick the primitive that matches the resolved
 * shape (a stat grid uses `SkeletonStatRow`, a data grid uses `SkeletonTable`,
 * free text uses `SkeletonLine`), so there's no layout jump when real content
 * lands. For an in-place client action (a Save button), keep the existing
 * button-label-swap pattern instead — these are for the initial/section load.
 */

const PULSE = 'bg-gray-100 dark:bg-gray-700 rounded animate-pulse'

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`${PULSE} h-4 w-full ${className}`.trim()} />
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3 ${className}`.trim()}
    >
      <div className={`${PULSE} h-3 w-24`} />
      <div className={`${PULSE} h-7 w-16`} />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`${PULSE} h-4 flex-1`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonStatRow({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
