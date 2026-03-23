'use client'

export default function TicketsError({ reset }: { reset: () => void }) {
  return (
    <div className="p-6">
      <p className="text-sm text-red-600 mb-3">Failed to load tickets.</p>
      <button onClick={reset} className="text-sm text-slate-700 underline">
        Try again
      </button>
    </div>
  )
}
