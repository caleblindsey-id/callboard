import Link from 'next/link'

// App-level 404 — a stale deep link (deleted ticket, old bookmark) previously
// hit Next's bare default page with no way back into the app.
export default function NotFound() {
  return (
    <div className="p-6 max-w-lg">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          Page not found
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          This page does not exist or may have been removed.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
