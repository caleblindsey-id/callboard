'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { InactiveEquipmentProspect } from '@/lib/db/equipment'
import { Star, Trash2, Eye, EyeOff, X } from 'lucide-react'
import FilterBar from '@/components/ui/FilterBar'
import DataTable, { type DataTableColumn } from '@/components/ui/DataTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'

const REMOVAL_REASONS = [
  'Equipment no longer in operation',
  'Customer lost',
  'Replaced by new equipment',
  'Other',
]

interface ProspectListProps {
  prospects: InactiveEquipmentProspect[]
}

function equipmentLabel(p: InactiveEquipmentProspect): string {
  return [p.make, p.model].filter(Boolean).join(' ') || '—'
}

// Static (no closures over component state) — safe at module scope.
const REMOVED_COLUMNS: DataTableColumn<InactiveEquipmentProspect>[] = [
  {
    key: 'customer',
    header: 'Customer',
    cardPrimary: true,
    className: 'font-medium',
    render: (p) => p.customerName ?? '—',
  },
  {
    key: 'equipment',
    header: 'Equipment',
    cardLabel: '',
    render: (p) => equipmentLabel(p),
  },
  {
    key: 'location',
    header: 'Location',
    render: (p) => p.locationOnSite ?? '—',
  },
  {
    key: 'revenue',
    header: 'Revenue',
    render: (p) => (p.totalRevenue > 0 ? `$${p.totalRevenue.toFixed(2)}` : '—'),
  },
  {
    key: 'reason',
    header: 'Reason',
    render: (p) => p.removalReason ?? '—',
  },
  {
    key: 'note',
    header: 'Note',
    className: 'text-xs italic',
    render: (p) => p.removalNote ?? '—',
  },
]

export default function ProspectList({ prospects }: ProspectListProps) {
  const router = useRouter()
  const [showRemoved, setShowRemoved] = useState(false)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removalReason, setRemovalReason] = useState(REMOVAL_REASONS[0])
  const [removalNote, setRemovalNote] = useState('')

  const active = prospects.filter((p) => !p.removed)
  const removed = prospects.filter((p) => p.removed)

  // useCallback (not a plain function decl) so it has a stable identity for the
  // activeColumns useMemo below — its only consumer, via the Prospect button.
  const handleMarkProspect = useCallback(
    async (equipmentId: string) => {
      setLoading((prev) => ({ ...prev, [equipmentId]: true }))
      try {
        const res = await fetch(`/api/prospects/${equipmentId}`, { method: 'PATCH' })
        if (res.ok) router.refresh()
      } finally {
        setLoading((prev) => ({ ...prev, [equipmentId]: false }))
      }
    },
    [router],
  )

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

  // Depends on handlers/state via closure, so it's built per-render (memoized), not
  // hoisted to module scope like REMOVED_COLUMNS above.
  const activeColumns = useMemo<DataTableColumn<InactiveEquipmentProspect>[]>(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        sortValue: (p) => p.customerName,
        cardPrimary: true,
        className: 'text-gray-900 dark:text-white font-medium',
        render: (p) => p.customerName ?? '—',
      },
      {
        key: 'equipment',
        header: 'Equipment',
        sortValue: (p) => [p.make, p.model].filter(Boolean).join(' ') || null,
        cardLabel: '',
        render: (p) => (
          <>
            <div>{equipmentLabel(p)}</div>
            {p.serialNumber && (
              <div className="text-xs text-gray-400 dark:text-gray-500">SN: {p.serialNumber}</div>
            )}
          </>
        ),
      },
      {
        key: 'location',
        header: 'Location',
        sortValue: (p) => p.locationOnSite,
        render: (p) => p.locationOnSite ?? '—',
      },
      {
        key: 'lastService',
        header: 'Last Service',
        sortValue: (p) => p.lastServiceDate,
        render: (p) => (p.lastServiceDate ? new Date(p.lastServiceDate).toLocaleDateString() : '—'),
      },
      {
        key: 'lastTech',
        header: 'Last Tech',
        sortValue: (p) => p.lastTechnician,
        render: (p) => p.lastTechnician ?? '—',
      },
      {
        key: 'revenue',
        header: 'Revenue',
        sortValue: (p) => p.totalRevenue,
        align: 'right',
        className: 'text-gray-900 dark:text-white font-medium',
        render: (p) => (p.totalRevenue > 0 ? `$${p.totalRevenue.toFixed(2)}` : '—'),
      },
      {
        key: 'contact',
        header: 'PM Contact',
        sortValue: (p) => p.contactName,
        cardLabel: '',
        className: 'text-xs',
        render: (p) =>
          p.contactName || p.contactEmail || p.contactPhone ? (
            <>
              {p.contactName && <div>{p.contactName}</div>}
              {p.contactEmail && (
                <div className="text-gray-400 dark:text-gray-500">{p.contactEmail}</div>
              )}
              {p.contactPhone && (
                <div className="text-gray-400 dark:text-gray-500">{p.contactPhone}</div>
              )}
            </>
          ) : (
            '—'
          ),
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (p) => (p.isProspect ? 1 : 0),
        cardLabel: '',
        render: (p) =>
          p.isProspect ? (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Prospect
            </span>
          ) : null,
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        interactive: true,
        render: (p) => (
          <div className="flex items-center gap-2 lg:justify-end">
            {!p.isProspect && (
              <button
                onClick={() => handleMarkProspect(p.equipmentId)}
                disabled={loading[p.equipmentId]}
                className="inline-flex items-center gap-1 px-3 h-11 lg:h-auto lg:px-2.5 lg:py-1.5 text-sm lg:text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40 disabled:opacity-50"
              >
                <Star className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
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
              className="inline-flex items-center gap-1 px-3 h-11 lg:h-auto lg:px-2.5 lg:py-1.5 text-sm lg:text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              Remove
            </button>
          </div>
        ),
      },
    ],
    [loading, handleMarkProspect],
  )

  if (prospects.length === 0) {
    return <EmptyState icon={Star} message={emptyCopy('inactive equipment', false)} />
  }

  return (
    <div className="space-y-4">
      {/* Toggle removed */}
      {removed.length > 0 && (
        <FilterBar activeCount={showRemoved ? 1 : 0}>
          <button
            onClick={() => setShowRemoved(!showRemoved)}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {showRemoved ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showRemoved ? 'Hide' : 'Show'} removed ({removed.length})
          </button>
        </FilterBar>
      )}

      {/* Active prospects */}
      {active.length === 0 && !showRemoved ? (
        <EmptyState
          icon={Star}
          message={
            removed.length > 0
              ? 'No active prospects. All inactive equipment has been removed.'
              : emptyCopy('active prospects', false)
          }
        />
      ) : (
        active.length > 0 && (
          <DataTable
            rows={active}
            columns={activeColumns}
            rowKey={(p) => p.equipmentId}
            rowHref={(p) => `/equipment/${p.equipmentId}`}
            rowAriaLabel={(p) => `View ${p.customerName ?? 'equipment'}`}
            empty={<EmptyState icon={Star} message={emptyCopy('active prospects', false)} />}
            renderRowExpansion={(p) =>
              removingId === p.equipmentId ? (
                <RemovalForm
                  reason={removalReason}
                  note={removalNote}
                  onReasonChange={setRemovalReason}
                  onNoteChange={setRemovalNote}
                  onConfirm={() => handleRemove(p.equipmentId)}
                  onCancel={() => setRemovingId(null)}
                  loading={loading[p.equipmentId]}
                />
              ) : null
            }
          />
        )
      )}

      {/* Removed items */}
      {showRemoved && removed.length > 0 && (
        <div className="opacity-75">
          <DataTable
            rows={removed}
            columns={REMOVED_COLUMNS}
            rowKey={(p) => p.equipmentId}
            empty={<EmptyState icon={Star} message="No removed items." />}
          />
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
