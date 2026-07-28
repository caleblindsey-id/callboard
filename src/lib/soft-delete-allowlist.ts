// Sites that intentionally read tickets without .is('deleted_at', null).
//
// Soft-deleted tickets keep their pre-delete status and RLS does not filter
// them, so every multi-row read normally needs the guard. These are the
// deliberate exceptions. Each one needs a reason: the test fails without it.
//
// Adding an entry here is a decision, not a formality. If you are unsure
// whether a site belongs here, it does not.
export type AllowlistEntry = { file: string; line: number; reason: string }

export const SOFT_DELETE_ALLOWLIST: AllowlistEntry[] = [
  {
    file: 'src/lib/db/auditEvents.ts',
    line: 104,
    reason:
      'Same rationale as the service_tickets half of this Promise.all on the next line: resolving a work order number to ticket ids for the audit trail has to find deleted PM tickets too, or a deleted ticket\'s history stops rendering.',
  },
  {
    file: 'src/lib/db/auditEvents.ts',
    line: 105,
    reason:
      'Audit history must outlive deletion. Resolving a work order number to ticket ids has to find deleted tickets so their trail still renders.',
  },
  // src/lib/db/service-tickets.ts:153 and :162 were allowlisted here in the
  // first pass. Removed in the fix round: the checker now mechanically
  // recognizes delegation to applyServiceTicketFilters (both the direct
  // pass-through and the X = applyServiceTicketFilters(X, ...) reassignment
  // form), so both sites are no longer findings at all. This was a rule the
  // plan specified and Task 2 had not implemented yet, not a judgment call,
  // so a mechanical exemption is correct instead of a standing allowlist entry.

  // The five billing routes (PM: mark-billed, unexport; service: export,
  // mark-billed, unexport) and the service-ticket bulk-assign notifier were
  // allowlisted here in the Task 4 first pass on the theory that the id set
  // each one receives was already guarded upstream (the awaiting-invoice
  // board query, or the bulk-assign update). Fix round 1 (2026-07-28) closed
  // that instead of documenting it: the routes themselves never re-checked
  // deleted_at, soft-delete does not clear status/billing_exported
  // (tickets/[id]/route.ts's DELETE handler only touches deleted_at and
  // deleted_by_id), and a stale tab or a crafted POST does not go through
  // the UI's upstream guard. All six now carry .is('deleted_at', null) on
  // both the fetch and, where one exists, the CAS update, so they are no
  // longer findings.

  {
    file: 'src/app/api/tickets/route.ts',
    line: 52,
    reason:
      'Deliberately deleted_at-inclusive. This duplicate check (same equipment + month/year, not billed) exists to keep the manual create path consistent with the rest of the PM lifecycle, which treats a soft-deleted ticket as still occupying its slot: pm-generation.ts:241 uses the identical deleted_at-inclusive pre-fetch on purpose to block auto-regeneration, and the DB-level UNIQUE(pm_schedule_id, month, year) constraint (migration 004) is not partial on deleted_at, so tickets/[id]/restore/route.ts has to handle the resulting 23505 as an expected case. This check keys on equipment_id (there is no active manual-create schedule id yet at the time of the check), while the constraint and the two cross-referenced sites key on pm_schedule_id; the two are only equivalent because the system relies on the convention that a piece of equipment has at most one active pm_schedule (equipment.default_products/schedule linkage in this file, not a schema constraint: there is no UNIQUE on pm_schedules.equipment_id). If that convention is ever violated, this check and the schedule-keyed ones could disagree. Given that dependency, removing deleted_at here alone would still recreate the asymmetry: a manager could delete a mis-created PM and manually recreate a duplicate that batch generation and restore would still refuse.',
  },
  {
    file: 'src/lib/pm-generation.ts',
    line: 241,
    reason:
      'Deliberately deleted_at-inclusive per the function\'s own comment: soft-deleted tickets still block regeneration on purpose, so batch generation cannot re-create a duplicate for the same schedule/equipment and month right after a delete. Removing the guard here would also create the schedule-vs-manual asymmetry described at src/app/api/tickets/route.ts:52.',
  },
]
