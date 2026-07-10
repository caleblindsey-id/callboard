'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors, type SortDir, type SortValue } from '@/lib/hooks/useSortableTable'

export interface DataTableColumn<Row> {
  key: string
  header: string
  /** Desktop cell content AND the mobile card value for this column. */
  render: (row: Row) => ReactNode
  /** Present = sortable (drives the shared header + `useSortableTable`). Absent = static column. */
  sortValue?: (row: Row) => SortValue
  /** Mobile card label. `undefined` = use `header`. `null` = omit this field from the
   * card entirely. `''` = show the value with no label prefix (badges, chips). */
  cardLabel?: string | null
  /** Renders as the card's bold title line instead of a labeled row. Exactly one column
   * per table should set this. */
  cardPrimary?: boolean
  /** Marks a column that renders its own interactive controls (buttons, an inline
   * expand trigger). Excluded from the row-nav overlay on both breakpoints — on mobile
   * it renders below the card's `Link`, not inside it; on desktop it never receives the
   * click-through anchor, so its own onClick handlers fire normally. */
  interactive?: boolean
  align?: 'left' | 'right'
  className?: string
}

export interface DataTableProps<Row> {
  rows: Row[]
  columns: DataTableColumn<Row>[]
  rowKey: (row: Row) => string
  /** Per-row destination. Return null to leave a specific row inert. Omit the prop
   * entirely for a pure display table (no navigation, no chevron). */
  rowHref?: (row: Row) => string | null
  /** Accessible name for the row's link, read by screen readers ("View Acme Corp").
   * Falls back to a generic label when omitted. */
  rowAriaLabel?: (row: Row) => string
  /** Rendered in place of both the mobile card list and the desktop table when
   * `rows` is empty — pass an `EmptyState`. */
  empty: ReactNode
  initialSort?: { key: string; dir: SortDir }
  /** Fires after every sort toggle; sorting itself is always handled internally. */
  onSortChange?: (sort: { key: string; dir: SortDir }) => void
  /** Optional detail row rendered directly below a row on both breakpoints — for the
   * rare inline-expand-panel case (see standard-draft dimension 8's exceptions). */
  renderRowExpansion?: (row: Row) => ReactNode | null
  className?: string
}

const CELL = 'px-5 py-3'
const HEAD_CELL = 'px-5 py-3 font-medium text-gray-600 dark:text-gray-400'

export default function DataTable<Row>({
  rows,
  columns,
  rowKey,
  rowHref,
  rowAriaLabel,
  empty,
  initialSort,
  onSortChange,
  renderRowExpansion,
  className = '',
}: DataTableProps<Row>) {
  const accessors = useMemo(() => {
    const acc: SortAccessors<Row, string> = {}
    for (const col of columns) {
      if (col.sortValue) acc[col.key] = col.sortValue
    }
    return acc
  }, [columns])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<Row, string>(
    rows,
    accessors,
    initialSort,
  )

  // The first non-interactive column carries the one real, focusable row link (visible
  // focus ring, announced by screen readers). Every other non-interactive column gets an
  // aria-hidden decoy anchor purely so its area is part of the click target too — that's
  // what makes the *whole* row (minus interactive columns) navigable, not just one cell.
  const firstOverlayKey = useMemo(() => columns.find((c) => !c.interactive)?.key, [columns])

  function handleSort(key: string) {
    toggleSort(key)
    if (onSortChange) {
      const nextDir: SortDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
      onSortChange({ key, dir: nextDir })
    }
  }

  if (rows.length === 0) {
    return <>{empty}</>
  }

  const hasNav = Boolean(rowHref)

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`.trim()}
    >
      {/* Mobile cards — hidden on desktop */}
      <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map((row) => (
          <MobileCard
            key={rowKey(row)}
            row={row}
            columns={columns}
            href={rowHref?.(row) ?? null}
            ariaLabel={rowAriaLabel?.(row)}
            expansion={renderRowExpansion?.(row) ?? null}
          />
        ))}
      </div>

      {/* Desktop table — hidden on mobile */}
      <ScrollableTable className="hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {columns.map((col) =>
                col.sortValue ? (
                  <SortHeader
                    key={col.key}
                    label={col.header}
                    colKey={col.key}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align={col.align}
                    className={HEAD_CELL}
                  />
                ) : (
                  <th
                    key={col.key}
                    scope="col"
                    className={`${col.align === 'right' ? 'text-right' : 'text-left'} ${HEAD_CELL}`}
                  >
                    {col.header}
                  </th>
                ),
              )}
              {hasNav && (
                <th scope="col" className="w-8 px-3 py-3">
                  <span className="sr-only">Navigate</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map((row) => {
              const key = rowKey(row)
              const href = rowHref?.(row) ?? null
              const expansion = renderRowExpansion?.(row) ?? null
              return (
                <Fragment key={key}>
                  <tr className={href ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : ''}>
                    {columns.map((col) => {
                      const overlay = Boolean(href) && !col.interactive
                      const isFocusable = overlay && col.key === firstOverlayKey
                      return (
                        <td
                          key={col.key}
                          className={`${CELL} ${col.align === 'right' ? 'text-right' : ''} ${
                            overlay ? 'relative' : ''
                          } ${col.className ?? ''}`.trim()}
                        >
                          {overlay &&
                            (isFocusable ? (
                              <Link
                                href={href as string}
                                className="absolute inset-0 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
                              >
                                <span className="sr-only">{rowAriaLabel?.(row) ?? 'View details'}</span>
                              </Link>
                            ) : (
                              <Link
                                href={href as string}
                                aria-hidden="true"
                                tabIndex={-1}
                                className="absolute inset-0"
                              />
                            ))}
                          {col.render(row)}
                        </td>
                      )
                    })}
                    {hasNav && (
                      <td className="relative w-8 px-3 py-3">
                        {href && (
                          <>
                            <Link href={href} aria-hidden="true" tabIndex={-1} className="absolute inset-0" />
                            <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                  {expansion && (
                    <tr>
                      <td
                        colSpan={columns.length + (hasNav ? 1 : 0)}
                        className="px-5 py-3 bg-gray-50 dark:bg-gray-900"
                      >
                        {expansion}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  )
}

interface MobileCardProps<Row> {
  row: Row
  columns: DataTableColumn<Row>[]
  href: string | null
  ariaLabel?: string
  expansion: ReactNode | null
}

// Module-level (not nested in DataTable) per the no-inner-components rule — a component
// defined inside another component's body is re-created every render and unmounts its
// children, which loses focus on any input inside it.
function MobileCard<Row>({ row, columns, href, ariaLabel, expansion }: MobileCardProps<Row>) {
  const primary = columns.find((c) => c.cardPrimary)
  const secondary = columns.filter((c) => !c.cardPrimary && !c.interactive && c.cardLabel !== null)
  const interactive = columns.filter((c) => c.interactive)

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-white truncate">
          {primary?.render(row)}
        </div>
        {href && <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />}
      </div>
      {secondary.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {secondary.map((col) => {
            const value = col.render(row)
            if (value == null) return null
            const label = col.cardLabel === undefined ? col.header : col.cardLabel
            return (
              <p key={col.key} className="text-xs text-gray-500 dark:text-gray-400">
                {label ? `${label}: ` : ''}
                {value}
              </p>
            )
          })}
        </div>
      )}
    </>
  )

  return (
    <div>
      {href ? (
        <Link
          href={href}
          aria-label={ariaLabel}
          className="block px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
        >
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3">{body}</div>
      )}
      {interactive.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {interactive.map((col) => (
            <Fragment key={col.key}>{col.render(row)}</Fragment>
          ))}
        </div>
      )}
      {expansion && <div className="px-4 pb-3">{expansion}</div>}
    </div>
  )
}
