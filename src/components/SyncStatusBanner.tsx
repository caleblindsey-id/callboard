'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'

interface SyncStatus {
  last_sync: {
    sync_type: string
    started_at: string
    completed_at: string | null
    records_synced: number | null
    status: string | null
    error_message: string | null
  } | null
}

export default function SyncStatusBanner() {
  const [data, setData] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sync/status')
      .then((res) => res.json())
      .then((json) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 text-gray-400">
          <RefreshCw className="h-4 w-4 animate-spin text-gray-400 dark:text-gray-500" />
          <span className="text-sm text-gray-400 dark:text-gray-500">Loading sync status...</span>
        </div>
      </div>
    )
  }

  if (!data?.last_sync) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">No sync history available.</p>
      </div>
    )
  }

  const sync = data.last_sync
  const isSuccess = sync.status === 'success'
  const completedAt = sync.completed_at
    ? new Date(sync.completed_at).toLocaleString()
    : 'In progress'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSuccess ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Last Sync: {sync.sync_type}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{completedAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {sync.records_synced !== null && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {sync.records_synced} records
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isSuccess
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
            }`}
          >
            {sync.status}
          </span>
        </div>
      </div>
      {sync.error_message && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{sync.error_message}</p>
      )}
    </div>
  )
}
