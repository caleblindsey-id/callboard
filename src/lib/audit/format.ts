/**
 * Shared formatting for audit_events rows.
 * Used by both the global /admin/audit-log page and the per-record
 * AuditHistorySection so labels and diff rendering stay consistent.
 */

import { BUSINESS_TIME_ZONE, formatMoney } from '@/lib/format'

export type AuditAction = 'insert' | 'update' | 'delete'
export type AuditActorType = 'user' | 'customer' | 'system' | 'sync'

export type AuditEvent = {
  id: number
  occurred_at: string
  entity_type: string
  entity_id: string
  action: AuditAction
  actor_type: AuditActorType
  changed_by: string | null
  actor_label: string | null
  changes: Record<string, unknown>
  context: Record<string, unknown> | null
}

export type AuditEventWithActor = AuditEvent & {
  actor: { id: string; name: string; role: string | null } | null
}

export const ENTITY_LABELS: Record<string, string> = {
  service_tickets: 'Service Ticket',
  pm_tickets: 'PM Ticket',
  equipment: 'Equipment',
  pm_schedules: 'PM Schedule',
  customers: 'Customer',
  users: 'User',
}

export const ENTITY_TYPES = Object.keys(ENTITY_LABELS)

export const ACTION_LABELS: Record<AuditAction, string> = {
  insert: 'created',
  update: 'updated',
  delete: 'deleted',
}

// Human-readable column names per entity. Default falls back to the raw
// column name. Add entries as needed — coverage doesn't have to be exhaustive
// since the raw name is usually readable enough.
const COLUMN_LABELS: Record<string, Record<string, string>> = {
  service_tickets: {
    status: 'Status',
    assigned_technician_id: 'Assigned tech',
    customer_id: 'Customer',
    equipment_id: 'Equipment',
    problem_description: 'Problem',
    completion_notes: 'Completion notes',
    estimate_amount: 'Estimate',
    estimate_approved_at: 'Approved at',
    billing_amount: 'Billing amount',
    diagnostic_charge: 'Diagnostic charge',
    labor_rate_type: 'Labor rate',
    priority: 'Priority',
    manual_decision_note: 'Decision note',
  },
  pm_tickets: {
    status: 'Status',
    assigned_technician_id: 'Assigned tech',
    scheduled_date: 'Scheduled',
    completed_date: 'Completed',
    completion_notes: 'Completion notes',
    hours_worked: 'Hours worked',
    billing_amount: 'Billing amount',
    ship_to_location_id: 'Ship-to',
    deleted_at: 'Deleted at',
  },
  equipment: {
    make: 'Make',
    model: 'Model',
    serial_number: 'Serial',
    description: 'Description',
    location_on_site: 'Location on site',
    contact_name: 'Contact name',
    contact_email: 'Contact email',
    contact_phone: 'Contact phone',
    active: 'Active',
    default_technician_id: 'Default tech',
  },
  pm_schedules: {
    interval_months: 'Interval (months)',
    anchor_month: 'Anchor month',
    billing_type: 'Billing type',
    flat_rate: 'Flat rate',
    active: 'Active',
  },
  customers: {
    name: 'Name',
    credit_hold: 'Credit hold',
    po_required: 'PO required',
    ar_terms: 'AR terms',
    active: 'Active',
    show_pricing_on_pm_pdf: 'Show pricing on PDF',
    auto_approve_threshold: 'Auto-approve threshold',
  },
  users: {
    name: 'Name',
    email: 'Email',
    role: 'Role',
    active: 'Active',
    hourly_cost: 'Hourly cost',
  },
}

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType
}

export function columnLabel(entityType: string, column: string): string {
  return COLUMN_LABELS[entityType]?.[column] ?? column
}

// True when the diff entry is shaped like {old, new} — i.e. it came from an
// UPDATE. INSERT/DELETE rows store full values directly.
function isDiffPair(v: unknown): v is { old: unknown; new: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'old' in v &&
    'new' in v
  )
}

export function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') {
    // Truncate long blobs for the summary view; the full value is still in
    // the JSONB and the expanded view can show it.
    if (v.length > 80) return v.slice(0, 77) + '…'
    return v
  }
  if (typeof v === 'number') return v.toString()
  return JSON.stringify(v)
}

/**
 * Build a 1-2 line summary of the most salient diffs in an UPDATE row, for
 * the global page's table cell. Picks status transitions first, then any
 * other field changes.
 */
export function changeSummary(event: AuditEvent): string {
  if (event.action === 'insert') {
    return 'Created'
  }
  if (event.action === 'delete') {
    return 'Deleted'
  }

  const entries = Object.entries(event.changes ?? {})
  if (entries.length === 0) return '(no changes)'

  // Prefer status transitions for quick scanning.
  entries.sort(([a], [b]) => {
    if (a === 'status') return -1
    if (b === 'status') return 1
    return 0
  })

  const head = entries.slice(0, 2).map(([key, val]) => {
    const label = columnLabel(event.entity_type, key)
    if (isDiffPair(val)) {
      if (isComplexValue(val.old) || isComplexValue(val.new)) {
        return `${label}: ${summarizeComplexDiff(key, val.old, val.new).headline}`
      }
      return `${label}: ${renderValue(val.old)} → ${renderValue(val.new)}`
    }
    if (isComplexValue(val)) {
      return `${label}: ${summarizeComplexValue(key, val).headline}`
    }
    return `${label}: ${renderValue(val)}`
  })

  const tail = entries.length > 2 ? ` (+${entries.length - 2} more)` : ''
  return head.join(' · ') + tail
}

export type FormattedDiffEntry = {
  key: string
  label: string
  kind: 'pair' | 'value'
  old?: unknown
  new?: unknown
  value?: unknown
  // Set when the value(s) are an array or plain object. AuditHistorySection
  // renders `summary.headline` by default and reveals `summary.lines` behind
  // a "Show detail" disclosure instead of dumping renderValue()'s raw
  // JSON.stringify fallback.
  isComplex: boolean
  summary?: ComplexSummary
}

/**
 * Normalized diff for the expanded / inline detail views. Always returns an
 * array so the consumer renders one row per changed field.
 */
export function formatDiff(event: AuditEvent): FormattedDiffEntry[] {
  return Object.entries(event.changes ?? {}).map(([key, val]) => {
    const label = columnLabel(event.entity_type, key)
    if (isDiffPair(val)) {
      const isComplex = isComplexValue(val.old) || isComplexValue(val.new)
      return {
        key,
        label,
        kind: 'pair' as const,
        old: val.old,
        new: val.new,
        isComplex,
        summary: isComplex ? summarizeComplexDiff(key, val.old, val.new) : undefined,
      }
    }
    const isComplex = isComplexValue(val)
    return {
      key,
      label,
      kind: 'value' as const,
      value: val,
      isComplex,
      summary: isComplex ? summarizeComplexValue(key, val) : undefined,
    }
  })
}

// ============================================================
// Human summaries for array/object field diffs
//
// renderValue() falls through to JSON.stringify() for arrays/objects (see
// above) — fine for the global audit-log table cell, unreadable as the
// dominant content of a detail page's History section. These functions
// build a compact "N added, M removed" headline plus optional per-item
// detail lines for the known part-list fields, and a safe generic fallback
// ("[N items]" / shallow key-change summary) for anything else. Never falls
// back to raw JSON.stringify of the whole structure.
// ============================================================

export type ComplexSummary = {
  headline: string
  lines: string[]
}

// Array fields shaped like line items with description/product_number/
// quantity/unit_price (parts_used, additional_parts_used, estimate_parts,
// parts_requested) or a generic equivalent (items). Unlock the richer
// add/removed/changed-with-detail-lines summary.
export const PART_LIST_FIELDS = new Set([
  'parts_used',
  'additional_parts_used',
  'estimate_parts',
  'parts_requested',
  'items',
])

// Array fields of {storage_path, uploaded_at} — summarized as counts only,
// no per-item detail lines (a photo has no human label beyond its path).
export const PHOTO_LIST_FIELDS = new Set(['photos'])

type PartLike = {
  description?: string
  product_number?: string
  quantity?: number
  unit_price?: number
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isComplexValue(v: unknown): boolean {
  return Array.isArray(v) || isPlainObject(v)
}

// Identity key used to match an item across old/new arrays that carry no
// stable row id: prefer the Synergy item #, then the free-text description,
// falling back to a full-value key so unmatched/manual entries still diff
// deterministically instead of always reading as "added".
function partItemKey(item: unknown): string {
  if (isPlainObject(item)) {
    const p = item as PartLike
    if (p.product_number) return `pn:${p.product_number}`
    if (p.description) return `d:${p.description}`
  }
  return `json:${JSON.stringify(item)}`
}

function describeAddedPart(item: unknown): string {
  if (!isPlainObject(item)) return renderValue(item)
  const p = item as PartLike
  const qty = p.quantity ?? 1
  const desc = p.description ?? 'Item'
  return p.product_number ? `${qty}x ${desc} (${p.product_number})` : `${qty}x ${desc}`
}

function describeRemovedPart(item: unknown): string {
  if (!isPlainObject(item)) return renderValue(item)
  const p = item as PartLike
  const qty = p.quantity ?? 1
  const desc = p.description ?? 'Item'
  return `${qty}x ${desc}`
}

// Returns a "field: old -> new, field: old -> new" line for a matched pair
// whose quantity or price differs, or null when nothing tracked changed
// (e.g. only an internal sourcing field moved — not worth a detail line).
function diffPartItem(oldItem: unknown, newItem: unknown): string | null {
  if (!isPlainObject(oldItem) || !isPlainObject(newItem)) return null
  const o = oldItem as PartLike
  const n = newItem as PartLike
  const changes: string[] = []
  if ((o.quantity ?? null) !== (n.quantity ?? null)) {
    changes.push(`qty ${o.quantity ?? 'none'} -> ${n.quantity ?? 'none'}`)
  }
  if ((o.unit_price ?? null) !== (n.unit_price ?? null)) {
    changes.push(`price ${formatMoney(o.unit_price)} -> ${formatMoney(n.unit_price)}`)
  }
  if (changes.length === 0) return null
  const label = n.description ?? o.description ?? 'Item'
  return `${label}: ${changes.join(', ')}`
}

// Matches new items back to old items by partItemKey (queue per key, so
// duplicate descriptions/product numbers each get their own match) to
// classify every item as added, removed, or changed-in-place.
function summarizePartArrayDiff(oldArr: unknown[], newArr: unknown[]): ComplexSummary {
  const oldQueues = new Map<string, unknown[]>()
  for (const item of oldArr) {
    const k = partItemKey(item)
    const queue = oldQueues.get(k) ?? []
    queue.push(item)
    oldQueues.set(k, queue)
  }

  const addedLines: string[] = []
  const changedLines: string[] = []

  for (const newItem of newArr) {
    const k = partItemKey(newItem)
    const queue = oldQueues.get(k)
    if (queue && queue.length > 0) {
      const oldItem = queue.shift()
      const changeLine = diffPartItem(oldItem, newItem)
      if (changeLine) changedLines.push(`~ ${changeLine}`)
    } else {
      addedLines.push(`+ ${describeAddedPart(newItem)}`)
    }
  }

  const removedLines: string[] = []
  for (const queue of oldQueues.values()) {
    for (const item of queue) {
      removedLines.push(`- ${describeRemovedPart(item)}`)
    }
  }

  const parts: string[] = []
  if (addedLines.length) parts.push(`${addedLines.length} added`)
  if (removedLines.length) parts.push(`${removedLines.length} removed`)
  if (changedLines.length) parts.push(`${changedLines.length} changed`)

  return {
    headline: parts.length ? parts.join(', ') : 'No changes',
    lines: [...addedLines, ...removedLines, ...changedLines],
  }
}

function photoKey(item: unknown): string {
  if (isPlainObject(item) && typeof item.storage_path === 'string') return item.storage_path
  return JSON.stringify(item)
}

// Photos have no human label beyond their storage path, so this is counts
// only — no per-item detail lines.
function summarizePhotoArrayDiff(oldArr: unknown[], newArr: unknown[]): ComplexSummary {
  const oldKeys = new Set(oldArr.map(photoKey))
  const newKeys = new Set(newArr.map(photoKey))
  const added = [...newKeys].filter((k) => !oldKeys.has(k)).length
  const removed = [...oldKeys].filter((k) => !newKeys.has(k)).length

  const parts: string[] = []
  if (added) parts.push(`${added} added`)
  if (removed) parts.push(`${removed} removed`)

  return { headline: parts.length ? parts.join(', ') : 'No changes', lines: [] }
}

function summarizeUnknownArray(arr: unknown[]): ComplexSummary {
  return { headline: `[${arr.length} item${arr.length === 1 ? '' : 's'}]`, lines: [] }
}

// Shallow field-name diff for object-shaped JSONB columns we don't have a
// specific renderer for — never the full JSON.stringify of the object.
function summarizeUnknownObjectDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): ComplexSummary {
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  const changed = [...keys].filter((k) => JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k]))
  const headline = changed.length
    ? `${changed.length} field${changed.length === 1 ? '' : 's'} changed: ${changed.join(', ')}`
    : 'No changes'
  return { headline, lines: [] }
}

function summarizeUnknownObjectValue(obj: Record<string, unknown>): ComplexSummary {
  const keys = Object.keys(obj)
  return {
    headline: `${keys.length} field${keys.length === 1 ? '' : 's'}: ${keys.join(', ') || 'none'}`,
    lines: [],
  }
}

/**
 * Human summary for an UPDATE row's {old, new} pair where at least one side
 * is an array or plain object.
 */
export function summarizeComplexDiff(key: string, oldVal: unknown, newVal: unknown): ComplexSummary {
  if (Array.isArray(oldVal) || Array.isArray(newVal)) {
    const oldArr = Array.isArray(oldVal) ? oldVal : []
    const newArr = Array.isArray(newVal) ? newVal : []
    if (PHOTO_LIST_FIELDS.has(key)) return summarizePhotoArrayDiff(oldArr, newArr)
    if (PART_LIST_FIELDS.has(key)) return summarizePartArrayDiff(oldArr, newArr)
    return summarizeUnknownArray(Array.isArray(newVal) ? newArr : oldArr)
  }
  const oldObj = isPlainObject(oldVal) ? oldVal : {}
  const newObj = isPlainObject(newVal) ? newVal : {}
  return summarizeUnknownObjectDiff(oldObj, newObj)
}

/**
 * Human summary for an INSERT/DELETE row's single full-value snapshot when
 * it is an array or plain object.
 */
export function summarizeComplexValue(key: string, val: unknown): ComplexSummary {
  if (Array.isArray(val)) {
    if (PHOTO_LIST_FIELDS.has(key)) {
      return { headline: `${val.length} photo${val.length === 1 ? '' : 's'}`, lines: [] }
    }
    if (PART_LIST_FIELDS.has(key)) {
      return {
        headline: `${val.length} item${val.length === 1 ? '' : 's'}`,
        lines: val.map((item) => describeAddedPart(item)),
      }
    }
    return summarizeUnknownArray(val)
  }
  return summarizeUnknownObjectValue(isPlainObject(val) ? val : {})
}

export function actorDisplayName(event: AuditEventWithActor): string {
  if (event.actor) return event.actor.name
  if (event.actor_label) return event.actor_label
  if (event.actor_type === 'system') return 'System'
  if (event.actor_type === 'sync') return 'Sync job'
  if (event.actor_type === 'customer') return 'Customer'
  return 'Unknown'
}

export function formatOccurredAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Compact format suitable for table rows. Pinned to the business timezone and
  // en-US locale: AuditHistorySection is a server component, so Vercel SSR runs
  // this in UTC and an unpinned zone would print UTC times (e.g. a 9:01 AM CDT
  // event as 2:01 PM). Same fix as src/lib/format.ts's BUSINESS_TIME_ZONE pin.
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BUSINESS_TIME_ZONE,
  })
}
