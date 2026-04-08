'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { InactiveEquipmentProspect } from '@/lib/db/equipment'
import { Star, Trash2, Eye, EyeOff, ChevronRight, X } from 'lucide-react'

const REMOVAL_REASONS = [
  'Equipment no longer in operation',
  'Customer lost',
  'Replaced by new equipment',
  'Other',
]

interface ProspectListProps {
  prospects: InactiveEquipmentProspect[]
}

export default function ProspectList({ prospects }: ProspectListProps) {
  const router = useRouter()
  const [showRemoved, setShowRemoved] = useState(false)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removalReason, setRemovalReason] = useState(REMOVAL_REASONS[0])
  const [removalNote, setRemovalNote] = useState('')

  const active = prospects.filter((p) => !p.removed)
  const removed = prospects.filter((p) => p.removed)

  async function handleMarkProspect(equipmentId: string) {
    setLoading((prev) => ({ ...prev, [equipmentId]: true }))
    try {
      const res = await fetch(`/api/prospects/${equipmentId}`, { method: 'PATCH' })
      if (res.ok) router.refresh()
    } finally {
      setLoading((prev) => ({ ...prev, [equipmentId]: false }))
    }
  }

  async function handleRemove(equipmentId: string) {
    setLoading((prev) => ({ ...prev, [equipmentId]: true }))
    try {
      const res = await fetch(`/api/prospects/${equipmentId}/remove`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: removalReason, note: removalNote }),
      })
      if (res.ok) {
        setRemovingId(null)
        setRemovalReason(REMOVAL_REASONS[0])
        setRemovalNote('')
        router.refresh()
      }
    } finally {
      setLoading((prev) => ({ ...prev, [equipmentId]: false }))
    }
  }

  if (prospects.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No inactive equipment found.
      </div>
    )
  }

  const equipmentLabel = (p: InactiveEquipmentProspect) =>
    [p.make, p.model].filter(Boolean).join(' ') || '—'

  return (
    <div className="space-y-4">
      {/* Toggle removed */}
      {removed.length > 0 && (
        <button
          onClick={() => setShowRemoved(!showRemoved)}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 transition-colors"
        >
          {showRemoved ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showRemoved ? 'Hide' : 'Show'} removed ({removed.length})
        </button>
      )}

      {/* Active prospects */}
      {active.length === 0 && !showRemoved ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No active prospects. {removed.length > 0 && 'All inactive equipment has been removed.'}
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Mobile cards */}
              <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {active.map((p) => (
                  <div key={p.equipmentId} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {p.customerName ?? '—'}
                        </span>
                        {p.isProspect && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            Prospect
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => router.push(`/equipment/${p.equipmentId}`)}
                        className="p-1"
                      >
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{equipmentLabel(p)}</p>
                    {p.serialNumber && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">SN: {p.serialNumber}</p>
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      {p.locationOnSite && <p>Location: {p.locationOnSite}</p>}
                      <p>
                        Last service:{' '}
                        {p.lastServiceDate
                          ? new Date(p.lastServiceDate).toLocaleDateString()
                          : '—'}
                        {p.lastTechnician ? ` by ${p.lastTechnician}` : ''}
                      </p>
                      {p.totalRevenue > 0 && <p>Revenue: ${p.totalRevenue.toFixed(2)}</p>}
                      {p.contactName && <p>Contact: {p.contactName}</p>}
                    </div>
                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      {!p.isProspect && (
                        <button
                          onClick={() => handleMarkProspect(p.equipmentId)}
                          disabled={loading[p.equipmentId]}
                          className="flex items-center gap-1 px-3 h-11 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40 disabled:opacity-50"
                        >
                          <Star className="h-4 w-4" />
                          Prospect
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setRemovingId(p.equipmentId)
                          setRemovalReason(REMOVAL_REASONS[0])
                          setRemovalNote('')
                        }}
                        disabled={loading[p.equipmentId]}
                        className="flex items-center gap-1 px-3 h-11 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                    {/* Inline removal form */}
                    {removingId === p.equipmentId && (
                      <RemovalForm
                        reason={removalReason}
                        note={removalNote}
                        onReasonChange={setRemovalReason}
                        onNoteChange={setRemovalNote}
                        onConfirm={() => handleRemove(p.equipmentId)}
                        onCancel={() => setRemovingId(null)}
                        loading={loading[p.equipmentId]}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Last Service</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Last Tech</th>
                      <th className="px-5 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">PM Contact</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="px-5 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {active.map((p) => (
                      <>
                        <tr
                          key={p.equipmentId}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                          onClick={() => router.push(`/equipment/${p.equipmentId}`)}
                        >
                          <td className="px-5 py-3 text-gray-900 dark:text-white font-medium">
                            {p.customerName ?? '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                            <div>{equipmentLabel(p)}</div>
                            {p.serialNumber && (
                              <div className="text-xs text-gray-400 dark:text-gray-500">SN: {p.serialNumber}</div>
                            )}
                          </td>
                          <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{p.locationOnSite ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                            {p.lastServiceDate
                              ? new Date(p.lastServiceDate).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{p.lastTechnician ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-900 dark:text-white text-right font-medium">
                            {p.totalRevenue > 0 ? `$${p.totalRevenue.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-xs">
                            {p.contactName && <div>{p.contactName}</div>}
                            {p.contactEmail && (
                              <div className="text-gray-400 dark:text-gray-500">{p.contactEmail}</div>
                            )}
                            {p.contactPhone && (
                              <div className="text-gray-400 dark:text-gray-500">{p.contactPhone}</div>
                            )}
                            {!p.contactName && !p.contactEmail && !p.contactPhone && '—'}
                          </td>
                          <td className="px-5 py-3">
                            {p.isProspect && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                Prospect
                              </span>
                            )}
                          </td>
                          <td
                            className="px-5 py-3 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-2">
                              {!p.isProspect && (
                                <button
                                  onClick={() => handleMarkProspect(p.equipmentId)}
                                  disabled={loading[p.equipmentId]}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40 disabled:opacity-50"
                                >
                                  <Star className="h-3.5 w-3.5" />
                                  Prospect
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setRemovingId(p.equipmentId)
                                  setRemovalReason(REMOVAL_REASONS[0])
                                  setRemovalNote('')
                                }}
                                disabled={loading[p.equipmentId]}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                        {removingId === p.equipmentId && (
                          <tr key={`${p.equipmentId}-remove`}>
                            <td colSpan={9} className="px-5 py-3 bg-gray-50 dark:bg-gray-900">
                              <RemovalForm
                                reason={removalReason}
                                note={removalNote}
                                onReasonChange={setRemovalReason}
                                onNoteChange={setRemovalNote}
                                onConfirm={() => handleRemove(p.equipmentId)}
                                onCancel={() => setRemovingId(null)}
                                loading={loading[p.equipmentId]}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Removed items */}
      {showRemoved && removed.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden opacity-75">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Removed</h3>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {removed.map((p) => (
              <div key={p.equipmentId} className="px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {p.customerName ?? '—'}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{p.removalReason}</span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{equipmentLabel(p)}</p>
                {p.removalNote && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">{p.removalNote}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Revenue</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Reason</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {removed.map((p) => (
                  <tr key={p.equipmentId} className="text-gray-500 dark:text-gray-400">
                    <td className="px-5 py-3 font-medium">{p.customerName ?? '—'}</td>
                    <td className="px-5 py-3">{equipmentLabel(p)}</td>
                    <td className="px-5 py-3">{p.locationOnSite ?? '—'}</td>
                    <td className="px-5 py-3">
                      {p.totalRevenue > 0 ? `$${p.totalRevenue.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-3">{p.removalReason ?? '—'}</td>
                    <td className="px-5 py-3 text-xs italic">{p.removalNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function RemovalForm({
  reason,
  note,
  onReasonChange,
  onNoteChange,
  onConfirm,
  onCancel,
  loading,
}: {
  reason: string
  note: string
  onReasonChange: (v: string) => void
  onNoteChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}) {
  return (
    <div className="space-y-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-red-800 dark:text-red-300">Remove from Prospects</span>
        <button onClick={onCancel} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
        <select
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
        >
          {REMOVAL_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Additional details..."
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          className="px-4 h-11 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Removing...' : 'Confirm Remove'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 h-11 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
