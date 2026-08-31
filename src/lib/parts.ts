import type { PartRequest, PartUsed } from '@/types/database'

/**
 * Parts that are neither received nor cancelled — i.e. still on order.
 *
 * Used to block ticket completion and deletion: a ticket with parts on order
 * must have them received or cancelled before it can be completed or deleted,
 * so a live vendor PO never loses its parent ticket.
 */
export function partsOnOrder(
  parts: PartRequest[] | null | undefined
): PartRequest[] {
  return (parts ?? []).filter(isPartOutstanding)
}

/**
 * The one status/cancelled test behind every "is this part still outstanding?"
 * question. Deliberately structural rather than taking a full PartRequest: the
 * same judgement has to be made about a `parts_order_queue` view row, which
 * projects the JSONB element's status and cancelled flag as plain columns. The
 * board's readiness chip counts view rows while the detail page counts JSONB
 * entries, and they must never disagree about the same ticket.
 *
 * 'from_stock' is fulfilled in-house (pulled from the shelf, no PO), so it is
 * NOT outstanding — treated like 'received' for the completion/deletion gates.
 * 'pending_review' IS still in flight (not yet triaged) and correctly blocks.
 */
export function isPartOutstanding(part: {
  status?: string | null
  cancelled?: boolean | null
}): boolean {
  return part.status !== 'received' && part.status !== 'from_stock' && !part.cancelled
}

/**
 * True when the ticket has nothing outstanding on the parts side — every live
 * (non-cancelled) part is received or pulled from stock.
 *
 * Single source of truth for the `service_tickets.parts_received` column, which
 * gates the Start Work action and drives the board's waiting-on-parts filter.
 *
 * It does NOT gate service completion, whatever an earlier version of this
 * comment claimed — that gate is partsAwaitingReview() in
 * api/service-tickets/[id]/complete, scoped to 'pending_review' alone, and
 * nothing on the completion path reads parts_received at all. The wrong claim
 * here is the likely source of the equally wrong line in the office help guide.
 * It is
 * the exact complement of partsOnOrder(), and is written that way on purpose: the
 * column used to be derived by hand at each write site, and the copies drifted —
 * `api/service-tickets/[id]` required every live part to be 'received' while
 * `api/parts-queue/update` also accepted 'from_stock', so triaging a part to
 * pull-from-stock set the flag from one route and cleared it from the other.
 * Migration 146 backfills the rows written under the old rules.
 *
 * Vacuously true when nothing is live, which is deliberate: a ticket whose every
 * part was cancelled has nothing left to wait for, and the old `live.length > 0`
 * guard pinned those at false forever. Callers that need to distinguish "no parts
 * outstanding" from "no parts at all" must check the array themselves — the board
 * predicate does exactly that, via `OR parts_requested = '[]'`.
 */
export function partsAllFulfilled(
  parts: PartRequest[] | null | undefined
): boolean {
  return partsOnOrder(parts).length === 0
}

/**
 * Parts still awaiting office triage — status 'pending_review' and not cancelled.
 *
 * A pending_review part hasn't been acted on (order vs. pull-from-stock), so
 * completing a service ticket while one is present orphans it in the Parts Queue
 * Review tab with no home. Used to gate service completion (server + client).
 * Scoped to 'pending_review' only: 'requested'/'ordered' parts are already in
 * the office's active workflow and still allow completing the labor.
 */
export function partsAwaitingReview(
  parts: PartRequest[] | null | undefined
): PartRequest[] {
  return (parts ?? []).filter((p) => !p.cancelled && p.status === 'pending_review')
}

/**
 * Requested parts that have actually been fulfilled — received against a PO, or
 * pulled from our own stock — and not cancelled.
 *
 * Single source of truth for "the branch has this part in hand", shared by the
 * PM completion seed, the service Copy-Requested-Parts button, the auto-add on
 * fulfillment, and the missing-from-work-order check. Previously duplicated in
 * ServiceTicketDetail and TicketActions, which is exactly how the two ticket
 * types drift.
 *
 * Note this is deliberately looser than isPartStagedReady(): a from_stock part
 * counts as fulfilled the moment the office triages it, whether or not anyone
 * has physically pulled it off the shelf yet. Billing cares that we committed
 * the part; the pickup notification cares that it's on the counter.
 */
export function fulfilledRequestedParts(
  parts: PartRequest[] | null | undefined
): PartRequest[] {
  return (parts ?? []).filter(
    (p) => !p.cancelled && (p.status === 'received' || p.status === 'from_stock')
  )
}

/**
 * Normalized description for fuzzy part matching: lowercased, stripped of every
 * non-alphanumeric character. Techs retype descriptions freely ("MOTOR/FAN 120V
 * W/ CRIMPS 105162" on the request vs "VAC MOTOR" on the work order), so exact
 * string equality misses real matches and inflates the missing count.
 */
function normalizeDesc(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * True when `used` is the work-order line for `request`. Three tiers, strongest
 * first:
 *   1. from_request_at — the exact link stamped by the auto-add. Unambiguous.
 *   2. synergy_product_id — same catalog item on both sides.
 *   3. normalized description containment, either direction, plus the Synergy
 *      item # appearing inside the used description (a common tech shorthand:
 *      request "621923-001 Squeegee", WO line "Squeegee").
 *
 * Tier 3 is intentionally generous. A false match under-reports the problem;
 * a false MISS nags the tech about a part that is already billed, which trains
 * them to ignore the banner. Under-reporting is the cheaper error here.
 */
function usedLineMatchesRequest(used: PartUsed, request: PartRequest): boolean {
  if (used.from_request_at && request.requested_at) {
    return used.from_request_at === request.requested_at
  }
  if (request.synergy_product_id != null && used.synergy_product_id != null) {
    if (used.synergy_product_id === request.synergy_product_id) return true
  }
  const usedDesc = normalizeDesc(used.description)
  if (!usedDesc) return false
  const partNo = normalizeDesc(request.product_number)
  if (partNo.length > 3 && usedDesc.includes(partNo)) return true
  const reqDesc = normalizeDesc(request.description)
  if (reqDesc.length <= 3) return false
  return usedDesc.includes(reqDesc) || reqDesc.includes(usedDesc)
}

/**
 * Fulfilled requested parts that never made it onto the work order.
 *
 * This is the whole point of the feature. `parts_requested` (procurement) and
 * `parts_used` / `additional_parts_used` (the billable work order) are separate
 * JSONB arrays with no foreign key, and only the latter is read by billing, the
 * work-order PDF, and the billing export. A part could be requested, PO'd,
 * received, collected by the tech, and shown as fully fulfilled in the Parts
 * Queue while being worth $0 on the invoice — the branch eats the cost. Roughly
 * a quarter of fulfilled parts were landing that way.
 *
 * Pass every billable array the ticket has: service tickets pass parts_used; PM
 * tickets pass parts_used AND additional_parts_used, since a part may sit in
 * either depending on covered_by_agreement.
 *
 * Single source of truth behind the auto-add dedupe, the tech-facing banner,
 * and the office reconciliation report, so the three can't disagree about
 * whether a part is missing. (Same lesson as the from_stock waiting-count bug:
 * a hand-rolled second copy of this predicate is how it breaks.)
 */
export function partsMissingFromWorkOrder(
  requested: PartRequest[] | null | undefined,
  ...usedArrays: Array<PartUsed[] | null | undefined>
): PartRequest[] {
  const used = usedArrays.flatMap((arr) => arr ?? [])
  return fulfilledRequestedParts(requested).filter(
    (r) => !r.wo_excluded_at && !used.some((u) => usedLineMatchesRequest(u, r))
  )
}

/** The bits of a `products` row the work-order line cares about. */
export type PartCatalogInfo = {
  unit_price?: number | null
  requires_detail?: boolean | null
}

/**
 * Convert a fulfilled part request into a work-order line.
 *
 * `catalog` supplies the live products-table values when the part is
 * catalog-linked. The price on the request is a snapshot from request time and
 * can be weeks stale by the time the part is received, so the catalog price
 * wins when we have one. Falls back to the request's own unit_price (already
 * the CUSTOMER price — see the gate in validateNewManualPartRequests — not
 * cost), then to 0. Manual off-catalog parts have no catalog row and keep the
 * price the tech captured, which is the only price anyone ever had for them.
 *
 * Carries the sourcing fields through so an auto-added line is indistinguishable
 * from a properly hand-entered one downstream, and stamps from_request_at so the
 * part is never double-added.
 */
export function requestToUsedLine(
  request: PartRequest,
  catalog?: PartCatalogInfo | null
): PartUsed {
  const catalogPrice = catalog?.unit_price
  const price =
    typeof catalogPrice === 'number' && Number.isFinite(catalogPrice)
      ? catalogPrice
      : typeof request.unit_price === 'number' && Number.isFinite(request.unit_price)
        ? request.unit_price
        : 0
  const line: PartUsed = {
    synergy_product_id: request.synergy_product_id ?? null,
    quantity: request.quantity,
    description: request.description,
    unit_price: price,
  }
  if (request.detail) line.detail = request.detail
  if (catalog?.requires_detail) line.requires_detail = true
  if (request.product_number) line.product_number = request.product_number
  if (request.vendor_item_code) line.vendor_item_code = request.vendor_item_code
  if (request.vendor) line.vendor = request.vendor
  if (request.vendor_code) line.vendor_code = request.vendor_code
  if (request.requested_at) line.from_request_at = request.requested_at
  return line
}

/**
 * Actions that mean "this part just landed in the tech's hands" and so should
 * put a line on the work order.
 *
 * Deliberately NOT "any touch of an already-staged part": otherwise the office
 * patching a PO number on a received part would silently re-add a line the tech
 * had deleted on purpose. Parts fulfilled before this feature shipped are the
 * reconciliation report's job, not a side effect of an unrelated edit.
 */
export function isFulfillingAction(action: string): boolean {
  return action === 'mark_received' || action === 'mark_pulled'
}

/**
 * Actions that only record warehouse staging state and so stay legal after the
 * parent ticket is completed or billed.
 *
 * The completed/billed guard in /api/parts-queue/update protects billing rows
 * that have already been exported. `mark_pulled` writes nothing but
 * `pulled_at`/`pulled_by` on the request itself, so blocking it produced a pure
 * dead end: a part that was used but never ticked off before the tech completed
 * the job sits in the To Pull tab forever, and the 409 tells you to reopen the
 * ticket — which nulls customer_signature/customer_signature_name and deletes
 * the completion photos from Storage (feedback #85, WO-1187).
 *
 * This predicate governs the write guard ONLY. The side effects of a fulfilling
 * action still have to be suppressed separately on a closed ticket: see the
 * `ticketClosed` input to workOrderAutoAddPatch() for the work-order line, and
 * the parts-ready notification in the route. Anything added here needs that
 * same audit — which is why the list is one entry long.
 */
export function isStagingOnlyAction(action: string): boolean {
  return action === 'mark_pulled'
}

/**
 * True when a Parts Queue row's PARENT TICKET is closed, so the row is stranded:
 * still sitting in a work tab, but attached to a job nobody is going back to.
 *
 * The To Pull tab is where this bites. Neither ticket type gates completion on
 * `pulled_at` — service gates on partsAwaitingReview ('pending_review' only), and
 * PM's partsOnOrder accepts 'from_stock' whatever pulled_at says — so a stock
 * part can and does outlive its ticket. Measured on prod when this shipped: 5 of
 * the 7 rows in To Pull were on closed tickets. A tab that is mostly noise is a
 * tab people stop trusting, which is the actual failure this labels.
 *
 * Takes the status string rather than a row so the queue view, the tests, and any
 * future caller reading a ticket directly all share one definition.
 *
 * 'completed' and 'billed' are deliberately the same pair the write guard in
 * /api/parts-queue/update uses for `ticketClosed`. If those two ever disagree the
 * UI would badge a row the server still accepts writes on, or worse the reverse.
 * The others are terminal states a queue row should never be waiting on either.
 */
export function isQueueRowStranded(ticketStatus: string | null | undefined): boolean {
  if (!ticketStatus) return false
  return (
    ticketStatus === 'completed' ||
    ticketStatus === 'billed' ||
    ticketStatus === 'declined' ||
    ticketStatus === 'canceled' ||
    ticketStatus === 'skipped'
  )
}

/**
 * Decide whether a part that just changed state needs a work-order line, and
 * which array it belongs in.
 *
 * Pure so it can be tested without a database: the caller does the catalog
 * lookup and hands the result in. Returns the columns to merge into the
 * fn_update_parts_queue payload — which is how the line lands under the SAME
 * optimistic lock as the part status (migration 145). A separate follow-up
 * write would race the technician's completion-form autosave, which PUTs the
 * whole array, and quietly drop the line.
 *
 * `null` means "nothing to do": wrong action, part not actually in hand, part
 * already on the work order (so a re-fired mark_received is idempotent), or the
 * tech explicitly marked it not-used.
 */
export function workOrderAutoAddPatch(input: {
  source: 'pm' | 'service'
  action: string
  part: PartRequest
  existingUsed: PartUsed[] | null | undefined
  existingAdditional?: PartUsed[] | null | undefined
  catalog?: PartCatalogInfo | null
  ticketClosed?: boolean
}): { column: 'parts_used' | 'additional_parts_used'; value: PartUsed[]; line: PartUsed } | null {
  const { source, action, part, catalog } = input
  const existingUsed = input.existingUsed ?? []
  const existingAdditional = input.existingAdditional ?? []

  if (!isFulfillingAction(action)) return null
  // A completed/billed ticket's work-order lines are final — the tech signed
  // off on that parts list and billing may already be exported to Synergy.
  // mark_pulled is permitted on those tickets (isStagingOnlyAction) so the part
  // can leave the To Pull queue, but recording a late pull must never append a
  // billable line after the fact. Lives here rather than in the route so every
  // caller inherits it. See feedback #85.
  if (input.ticketClosed) return null
  // Stricter than fulfilledRequestedParts: a from_stock part only counts once
  // someone has physically pulled it, so a bare pull_from_stock triage can't
  // put a line on the work order before the part leaves the shelf.
  if (!isPartStagedReady(part)) return null

  // Same predicate the banner and the office report use, so the three can never
  // disagree about whether this part is already accounted for.
  const stillMissing = partsMissingFromWorkOrder(
    [part],
    existingUsed,
    source === 'pm' ? existingAdditional : null
  )
  if (stillMissing.length === 0) return null

  const line = requestToUsedLine(part, catalog)

  // PM splits covered-by-agreement parts (parts_used, forced to $0 at
  // completion) from billable extras (additional_parts_used), using the same
  // predicate as the completion seed in TicketActions so the auto-add and the
  // seed can never route the same part to different arrays. Service tickets
  // have a single billable array.
  if (source === 'pm' && !isCoveredByAgreement(part)) {
    return { column: 'additional_parts_used', value: [...existingAdditional, line], line }
  }
  return { column: 'parts_used', value: [...existingUsed, line], line }
}

/**
 * True when a fulfilled PM part is covered by the service agreement (goes on
 * parts_used at $0) rather than billable (goes on additional_parts_used at
 * price).
 *
 * `undefined` means the request predates the coverage picker, and defaults to
 * BILLABLE so a legacy part surfaces for review instead of silently going out
 * at $0. Mirrors the existing completion-seed split in TicketActions so the
 * auto-add and the seed can't route the same part differently.
 */
export function isCoveredByAgreement(part: PartRequest): boolean {
  return part.covered_by_agreement === true
}

/**
 * True when a part is staged and ready for the tech to pick up — the same
 * definition the My Parts "Ready for Pickup" tab uses: received, or a from_stock
 * part that's been physically pulled off the shelf. Cancelled parts never count.
 * Single source of truth shared by the mark_collected action and the
 * auto-stamp-on-completion sweep so the two can't drift.
 */
export function isPartStagedReady(p: PartRequest): boolean {
  return (
    !p.cancelled &&
    (p.status === 'received' || (p.status === 'from_stock' && !!p.pulled_at))
  )
}

/**
 * Stamp collected_at/collected_by on every staged-but-unacknowledged part.
 *
 * Called on ticket completion so a part the tech took but never tapped "Picked
 * Up" still gets a pickup record instead of vanishing with a blank collected_at.
 * Already-collected parts keep their original stamp; on-order / cancelled parts
 * are left alone. Returns the (possibly new) array plus whether anything changed,
 * so the caller can skip the write when there's nothing to do.
 */
export function stampCollectedOnStaged(
  parts: PartRequest[] | null | undefined,
  userId: string,
  nowIso: string,
): { parts: PartRequest[]; changed: boolean } {
  const list = parts ?? []
  let changed = false
  const out = list.map((p) => {
    if (isPartStagedReady(p) && !p.collected_at) {
      changed = true
      return { ...p, collected_at: nowIso, collected_by: userId }
    }
    return p
  })
  return { parts: out, changed }
}

/**
 * Server-side gate for required fields on NEW manual part requests.
 *
 * The office can't backfill a manual (off-catalog) request, so vendor name,
 * vendor part #, description, and a customer price are required. Catalog parts
 * (synergy_product_id set) resolve those office-side and are exempt.
 *
 * Scoped strictly to brand-new requested entries — matched by `requested_at`,
 * which every new-request flow stamps. Legacy rows (no timestamp) and any entry
 * already present in `existing` are skipped so editing or advancing an old
 * ticket never hard-fails. Returns an error message, or null when all clear.
 */
export function validateNewManualPartRequests(
  existing: PartRequest[] | null | undefined,
  incoming: PartRequest[],
): string | null {
  const seen = new Set(
    (existing ?? []).map((p) => p.requested_at).filter((t): t is string => !!t),
  )
  for (const p of incoming) {
    if (p.status !== 'pending_review') continue // new requests land in review
    if (!p.requested_at || seen.has(p.requested_at)) continue // legacy or pre-existing
    if (p.synergy_product_id != null) continue // catalog part — exempt
    if (!p.description?.trim()) {
      return 'A part description is required for each requested part.'
    }
    if (!p.vendor?.trim()) {
      return 'Vendor name is required on manually requested parts.'
    }
    if (!p.vendor_item_code?.trim()) {
      return 'Vendor part # is required on manually requested parts.'
    }
    const price = typeof p.unit_price === 'number' ? p.unit_price : NaN
    if (!Number.isFinite(price) || price < 0) {
      return 'A customer price (0 or more) is required on manually requested parts.'
    }
  }
  return null
}

/**
 * Find the first part that is being ordered / has been received but is missing
 * its Synergy item # (`product_number`). Returns the offending part, or
 * undefined when all clear — callers reject the PATCH with a 400.
 *
 * A Synergy item # is only mandatory once a part moves to 'ordered' or
 * 'received' (the office captures it at the ordering step). It is deliberately
 * NOT required on a fresh 'pending_review' request, a queued 'requested' part,
 * or a 'from_stock' pull — requiring it earlier blocked every off-catalog
 * (manual) part request, which have no Synergy item # by definition (feedback
 * #30). The earlier `status !== 'requested'` check wrongly caught
 * 'pending_review' (which is *before* 'requested', not after).
 */
export function findPartMissingSynergyItemNumber(
  parts: PartRequest[],
): PartRequest | undefined {
  return parts.find(
    (p) =>
      (p.status === 'ordered' || p.status === 'received') &&
      !p.product_number?.trim(),
  )
}

/**
 * True when `incoming` adds at least one brand-new requested part vs `existing`.
 *
 * Used to gate part requests on ticket machine info: the office must know which
 * machine a part is for, so a new request is blocked until make/model/serial are
 * on the ticket. Diffed by `requested_at` (every new-request flow stamps it) so
 * status changes on existing parts don't trip the gate. Legacy rows without a
 * timestamp are never counted as "new".
 */
export function hasNewRequestedPart(
  existing: PartRequest[] | null | undefined,
  incoming: PartRequest[],
): boolean {
  const seen = new Set(
    (existing ?? []).map((p) => p.requested_at).filter((t): t is string => !!t),
  )
  return incoming.some(
    (p) => p.status === 'pending_review' && !!p.requested_at && !seen.has(p.requested_at),
  )
}

/**
 * Statuses at which a requested quantity is still a *request* and may be
 * corrected: before triage, after triage, and after the PO is placed.
 *
 * Deliberately stops short of 'from_stock' and 'received'. Once the part is
 * physically in hand the quantity is a fact rather than an ask, and it has
 * already been copied onto the work order, where the completion form owns it.
 * 'cancelled' is terminal and never editable.
 */
export const QUANTITY_EDITABLE_STATUSES: ReadonlyArray<PartRequest['status']> = [
  'pending_review',
  'requested',
  'ordered',
]

/**
 * True when this part's quantity may still be changed.
 *
 * Structural rather than taking a full PartRequest so the Parts Queue can ask
 * the same question of a `parts_order_queue` view row, which projects status
 * and cancelled as plain columns. Same reasoning as isPartOutstanding: the
 * queue row and the JSONB entry must never disagree about the same part.
 */
export function canEditPartQuantity(part: {
  status?: string | null
  cancelled?: boolean | null
}): boolean {
  if (part.cancelled) return false
  return QUANTITY_EDITABLE_STATUSES.includes(part.status as PartRequest['status'])
}

/** Upper bound on a part quantity — a guard against a fat-fingered keypad, not a business rule. */
export const MAX_PART_QUANTITY = 999

/**
 * Parse a user-entered quantity. Mirrors normalizeShippingCharge's contract so
 * the client can reject bad input before any request goes out and the server can
 * reuse the identical rule.
 *
 * Whole numbers only: every one of the 480 live quantities in production is a
 * positive integer, parts are ordered by the each, and a fractional quantity
 * would flow onto a PO and an invoice that cannot express it. Blank is a
 * rejection rather than a clear — unlike shipping charge, there is no
 * "no quantity" state.
 */
export function normalizePartQuantity(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: false, error: 'Quantity is required.' }
  }
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, error: 'Quantity must be a number.' }
  }
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'Quantity must be a whole number.' }
  }
  if (n < 1) {
    return { ok: false, error: 'Quantity must be at least 1. Cancel the part instead of zeroing it.' }
  }
  if (n > MAX_PART_QUANTITY) {
    return { ok: false, error: `Quantity must be ${MAX_PART_QUANTITY} or less.` }
  }
  return { ok: true, value: n }
}

/**
 * Server-side gate on quantity changes in an incoming parts_requested array.
 *
 * Both work-order PATCH routes take the whole array, so the client could send
 * any quantity on any part — the edit window has to be enforced here, against
 * the STORED status, not the one in the payload. Returns an error message, or
 * null when all clear.
 *
 * Diffed by array position: parts are addressed by ordinal everywhere
 * (parts_order_queue.part_index), so the array is only ever appended to or
 * edited in place, never spliced or reordered. That also covers legacy rows
 * with no requested_at, which an identity-keyed diff would silently skip.
 */
export function validateQuantityEdits(
  previous: PartRequest[] | null | undefined,
  incoming: PartRequest[],
): string | null {
  const prev = previous ?? []
  const shared = Math.min(prev.length, incoming.length)
  for (let i = 0; i < shared; i++) {
    const before = prev[i]
    const after = incoming[i]
    // Both sides stamped, and they disagree: something reordered the array.
    // Refuse rather than validate one part's quantity against another's status.
    if (before.requested_at && after.requested_at && before.requested_at !== after.requested_at) {
      return 'The parts list changed while you were editing. Refresh and try again.'
    }
    if (after.quantity === before.quantity) continue
    if (!canEditPartQuantity(before)) {
      return `"${partLabel(before) || 'This part'}" is already ${
        before.cancelled ? 'cancelled' : 'in hand'
      }. Change the quantity on the work order's parts used instead.`
    }
    const parsed = normalizePartQuantity(after.quantity)
    if (!parsed.ok) return parsed.error
  }
  return null
}

/**
 * Work-order lines whose quantity has to follow a changed request quantity.
 *
 * Normally a no-op: a part is edited before it is fulfilled, so no work-order
 * line exists yet. It matters after a manager Reset — resetting a received part
 * to 'ordered' reopens the quantity for editing while leaving behind the line
 * the auto-add already put on the work order, and a stale quantity there is a
 * billing error, not a display one.
 *
 * Matched on the exact from_request_at link ONLY. Deliberately not
 * usedLineMatchesRequest: its synergy_product_id and description-containment
 * tiers are tuned to over-match, which is right for warning that a part might be
 * missing and wrong for silently rewriting a billable quantity. No exact link,
 * no sync — the reconciliation report already surfaces those.
 *
 * Returns the columns to merge into the caller's single write, or null when
 * there is nothing to do.
 */
export function quantitySyncPatch(input: {
  source: 'pm' | 'service'
  previous: PartRequest[] | null | undefined
  next: PartRequest[]
  existingUsed: PartUsed[] | null | undefined
  existingAdditional?: PartUsed[] | null | undefined
}): { parts_used?: PartUsed[]; additional_parts_used?: PartUsed[] } | null {
  const prev = input.previous ?? []
  const shared = Math.min(prev.length, input.next.length)
  const moved = new Map<string, number>()
  for (let i = 0; i < shared; i++) {
    const before = prev[i]
    const after = input.next[i]
    if (!before.requested_at) continue
    if (typeof after.quantity !== 'number' || after.quantity === before.quantity) continue
    moved.set(before.requested_at, after.quantity)
  }
  if (moved.size === 0) return null

  const restamp = (lines: PartUsed[] | null | undefined): PartUsed[] | null => {
    const list = lines ?? []
    let changed = false
    const out = list.map((line) => {
      const qty = line.from_request_at ? moved.get(line.from_request_at) : undefined
      if (qty === undefined || line.quantity === qty) return line
      changed = true
      return { ...line, quantity: qty }
    })
    return changed ? out : null
  }

  const used = restamp(input.existingUsed)
  // Service tickets have a single billable array; additional_parts_used is PM-only.
  const additional = input.source === 'pm' ? restamp(input.existingAdditional) : null
  if (!used && !additional) return null

  const patch: { parts_used?: PartUsed[]; additional_parts_used?: PartUsed[] } = {}
  if (used) patch.parts_used = used
  if (additional) patch.additional_parts_used = additional
  return patch
}

/**
 * Display label for a part line: the description, with any free-text `detail`
 * appended in-line (e.g. "SHOP SUPPLIES — rags, lubricant, fasteners").
 *
 * `detail` is captured for catch-all catalog items flagged products.requires_detail.
 * Single source of truth for the "description — detail" format so every render
 * site (on-screen lists + PDFs) stays consistent.
 */
export function partLabel(
  part: { description?: string | null; detail?: string | null }
): string {
  const desc = (part.description ?? '').trim()
  const detail = (part.detail ?? '').trim()
  return detail ? `${desc} — ${detail}` : desc
}

/**
 * The outcome of deciding which parts array a completion should persist.
 * `would_blank` means the caller asked to empty a work order that currently has
 * billable lines on it, which is refused rather than obeyed.
 */
export type CompletionPartsResolution<T> =
  | { ok: true; parts: T[] }
  | { ok: false; reason: 'would_blank'; storedCount: number }

/**
 * Resolve the parts array a `/complete` route should write.
 *
 * Both completion routes previously resolved `parts_used ?? []`, and neither
 * read the stored value first. That made "the client did not mention parts" and
 * "this job used no parts" the same instruction, so a caller could empty a
 * billable work order by accident and get a 200 back.
 *
 * It happened. The mobile Quick Complete sheet (live 2026-05-15 to 2026-06-29,
 * removed in PR #200) hardcoded `parts_used: []` in its submit body. Because it
 * was gated on `isMobile` it only ever fired for technicians, so it wiped 14
 * work orders across June while every desktop completion by the office was
 * fine. Ten were noticed and re-entered; WO-1006 ($264.45, including a $249.72
 * vacuum motor) and WO-837 ($113.76) were invoiced for labor and a trip charge
 * only. Nothing in the stack objected.
 *
 * The rule this encodes: a completion may add, edit, or remove SOME lines, but
 * it may not take a populated work order to none. Deliberately narrow, because
 * a technician removing a part they did not end up fitting is legitimate and
 * must not be blocked. Clearing the last line is done in the parts UI, which is
 * an explicit act, not a side effect of pressing Complete.
 */
export function resolveCompletionParts<T>(
  submitted: T[] | null | undefined,
  stored: T[] | null | undefined
): CompletionPartsResolution<T> {
  const storedLines = Array.isArray(stored) ? stored : []

  // Omitted entirely: keep what the row already has. Silence is not an
  // instruction to delete.
  if (submitted === null || submitted === undefined) {
    return { ok: true, parts: storedLines }
  }

  if (submitted.length === 0 && storedLines.length > 0) {
    return { ok: false, reason: 'would_blank', storedCount: storedLines.length }
  }

  return { ok: true, parts: submitted }
}
