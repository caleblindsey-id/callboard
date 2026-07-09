'use client'

import { useDeferredValue, useMemo } from 'react'
import { Wrench } from 'lucide-react'
import type { EquipmentListItem } from './page'
import { formatDate } from '@/lib/format'
import FilterBar from '@/components/ui/FilterBar'
import DataTable, { type DataTableColumn } from '@/components/ui/DataTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

interface EquipmentListProps {
  equipment: EquipmentListItem[]
  initialFilters: { q: string; active: string }
}

function makeModelRaw(e: EquipmentListItem): string | null {
  return [e.make, e.model].filter(Boolean).join(' ') || null
}

function makeModel(e: EquipmentListItem): string {
  return makeModelRaw(e) ?? '—'
}

function formatNextService(dateStr: string | null): { text: string; className: string } {
  if (!dateStr) return { text: '—', className: 'text-gray-400 dark:text-gray-600' }

  const [yearStr, monthStr] = dateStr.split('-')
  const year = parseInt(yearStr)
  const month = parseInt(monthStr)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const label = new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { text: label, className: 'text-red-600 dark:text-red-400 font-medium' }
  }
  if (year === currentYear && month === currentMonth) {
    return { text: label, className: 'text-amber-600 dark:text-amber-400 font-medium' }
  }
  return { text: label, className: 'text-gray-600 dark:text-gray-400' }
}

const EQUIPMENT_COLUMNS: DataTableColumn<EquipmentListItem>[] = [
  {
    key: 'customer',
    header: 'Customer',
    sortValue: (e) => e.customers?.name,
    cardPrimary: true,
    className: 'text-gray-900 dark:text-white',
    render: (e) => e.customers?.name ?? '—',
  },
  {
    key: 'makeModel',
    header: 'Make / Model',
    sortValue: (e) => makeModelRaw(e),
    cardLabel: '',
    render: (e) => makeModel(e),
  },
  {
    key: 'serial',
    header: 'Serial Number',
    sortValue: (e) => e.serial_number,
    cardLabel: 'S/N',
    render: (e) => e.serial_number ?? '—',
  },
  {
    key: 'location',
    header: 'Location',
    sortValue: (e) => e.location_on_site,
    render: (e) => e.location_on_site ?? '—',
  },
  {
    key: 'lastService',
    header: 'Last Service',
    sortValue: (e) => e.lastServiceDate,
    render: (e) => formatDate(e.lastServiceDate),
  },
  {
    key: 'nextService',
    header: 'Next Service',
    sortValue: (e) => e.nextServiceDate,
    render: (e) => {
      const next = formatNextService(e.nextServiceDate)
      return <span className={next.className}>{next.text}</span>
    },
  },
  {
    key: 'status',
    header: 'Status',
    sortValue: (e) => (e.active ? 0 : 1),
    cardLabel: '',
    render: (e) => (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
          e.active
            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
        }`}
      >
        {e.active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
]

export default function EquipmentList({ equipment, initialFilters }: EquipmentListProps) {
  // Filters live in the URL so the Back button restores the filtered view.
  const { filters, set } = useUrlFilters(initialFilters)
  const search = filters.q
  const showActive = filters.active !== 'inactive'

  // useDeferredValue lets React keep the input snappy on every keystroke and
  // recompute the filtered list at lower priority — input stays responsive
  // even when the equipment array is large.
  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => {
    return equipment.filter((e) => {
      if (showActive && !e.active) return false
      if (!showActive && e.active) return false
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase()
        const name = e.customers?.name?.toLowerCase() ?? ''
        const serial = e.serial_number?.toLowerCase() ?? ''
        return name.includes(q) || serial.includes(q)
      }
      return true
    })
  }, [equipment, showActive, deferredSearch])

  return (
    <>
      {/* Controls */}
      <FilterBar
        search={{
          value: search,
          onChange: (v) => set('q', v, { debounce: true }),
          placeholder: 'Search by customer or serial number...',
        }}
        segmented={{
          options: [
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ],
          value: showActive ? 'active' : 'inactive',
          onChange: (v) => set('active', v === 'inactive' ? 'inactive' : ''),
          ariaLabel: 'Filter equipment by active status',
        }}
        activeCount={showActive ? 0 : 1}
      />

      <DataTable
        rows={filtered}
        columns={EQUIPMENT_COLUMNS}
        rowKey={(e) => e.id}
        rowHref={(e) => `/equipment/${e.id}`}
        rowAriaLabel={(e) => `View ${e.customers?.name ?? 'equipment'}`}
        empty={
          <EmptyState
            icon={Wrench}
            message={emptyCopy('equipment', Boolean(search.trim()) || !showActive)}
          />
        }
      />
    </>
  )
}
