'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, RotateCcw } from 'lucide-react'

interface Props {
  deletedAt: string
  deletedByName: string | null
  canRestore: boolean
  // Restore endpoint for this ticket type — PM and service post to different
  // routes, so the caller supplies the URL.
  restoreUrl: string
  // PM-only tail note ("Won't be regenerated."); service has no regeneration.
  extraNote?: string
}

export default function DeletedBanner({ deletedAt, deletedByName, canRestore, restoreUrl, extraNote }: Props) {
  const router = useRouter()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const when = new Date(deletedAt).toLocaleString()

  async function handleRestore() {
    setRestoring(true)
    setError(null)
    try {
      const res = await fetch(restoreUrl, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to restore ticket')
        return
      }
      router.refresh()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border-2 border-gray-300 dark:border-gray-700 rounded-lg p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Trash2 className="h-5 w-5 text-gray-500 dark:text-gray-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-gray-900 dark:text-white">This ticket is deleted</p>
            <p className="text-gray-600 dark:text-gray-400 mt-0.5">
              Deleted {when}
              {deletedByName && <> by {deletedByName}</>}. Hidden from boards, billing, and PDFs.
              {extraNote && <> {extraNote}</>}
            </p>
          </div>
        </div>
        {canRestore && (
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-gray-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px] sm:min-h-0 shrink-0"
          >
            <RotateCcw className="h-4 w-4" />
            {restoring ? 'Restoring...' : 'Restore'}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
