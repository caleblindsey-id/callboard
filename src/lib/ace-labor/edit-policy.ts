import type { AceLaborStatus, UserRole } from '@/types/database'

/**
 * Who may edit an ACE labor entry, and what the edit does to its status.
 *
 * Two callers reach the same PATCH route with different rights:
 *
 *   - the submitting tech, fixing their own entry (the original flow); and
 *   - a manager / super_admin correcting someone else's entry in review,
 *     instead of rejecting it and waiting for the tech to resubmit
 *     (feedback #93).
 *
 * Editable statuses are the same for both: `pending` and `rejected` only.
 * An `approved` entry carries `rate_value_at_approval` — the snapshot the
 * payout report multiplies by hours — and may already sit inside a locked
 * payout period (`fn_lock_payout_period` re-checks that every ACE line is
 * still `approved`). Editing hours there would silently move a settled
 * number, so approved and paid entries stay closed to everyone; the way
 * back is reject, or a deliberate super_admin delete.
 *
 * Split out of the route so the decision is unit-testable — there are no
 * route tests in this repo.
 */

const STAFF_EDIT_ROLES: UserRole[] = ['super_admin', 'manager']
const EDITABLE_STATUSES: AceLaborStatus[] = ['pending', 'rejected']

export type AceEditActor = {
  id: string
  role: UserRole | null
}

export type AceEditTarget = {
  tech_id: string
  status: AceLaborStatus
}

export type AceEditDecision =
  | { allowed: true; asStaff: boolean; resubmits: boolean }
  | { allowed: false; reason: 'forbidden' | 'status' }

/** True when `role` may edit an entry it did not submit. */
export function canStaffEditAceEntries(role: UserRole | null | undefined): boolean {
  return !!role && STAFF_EDIT_ROLES.includes(role)
}

/** True when an entry in this status is open to edits at all. */
export function isEditableAceStatus(status: AceLaborStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

/**
 * Decide whether `actor` may edit `entry`.
 *
 * `resubmits` means the write should also clear the rejection and put the
 * entry back in the pending queue — true for any edit of a `rejected` entry,
 * whether the tech is resubmitting or a manager is undoing their own
 * mistaken rejection.
 *
 * Order matters: the ownership/role check runs before the status check so a
 * stranger gets 403 rather than learning the entry's status from a 409.
 */
export function decideAceEdit(
  actor: AceEditActor,
  entry: AceEditTarget,
): AceEditDecision {
  const asStaff = canStaffEditAceEntries(actor.role)
  const isOwner = entry.tech_id === actor.id

  if (!asStaff && !isOwner) return { allowed: false, reason: 'forbidden' }
  if (!isEditableAceStatus(entry.status)) return { allowed: false, reason: 'status' }

  return {
    allowed: true,
    // An owner editing their own entry is acting as the submitter even when
    // they also hold a staff role — it is their own submission either way.
    asStaff: asStaff && !isOwner,
    resubmits: entry.status === 'rejected',
  }
}
