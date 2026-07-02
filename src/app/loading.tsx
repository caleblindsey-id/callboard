// Route-level loading state for every page under the app shell. Before this,
// no route had a loading.tsx, so navigation on a slow connection (a tech on
// cellular) showed a frozen page or a blank screen until every server query
// resolved. A lightweight pulse skeleton paints immediately instead.
export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-56 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-80 max-w-full rounded bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="space-y-4">
        <div className="h-24 rounded-lg bg-gray-100 dark:bg-gray-800" />
        <div className="h-64 rounded-lg bg-gray-100 dark:bg-gray-800" />
        <div className="h-64 rounded-lg bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>
  )
}
