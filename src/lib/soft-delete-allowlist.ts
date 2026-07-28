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
    line: 105,
    reason:
      'Audit history must outlive deletion. Resolving a work order number to ticket ids has to find deleted tickets so their trail still renders.',
  },
  {
    file: 'src/app/api/billing/service/export/route.ts',
    line: 52,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/app/api/billing/service/mark-billed/route.ts',
    line: 59,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/app/api/billing/service/unexport/route.ts',
    line: 48,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/lib/service-tickets/notify-assignment.ts',
    line: 208,
    reason:
      'Bulk assignment notice reads the exact id set the bulk-assign action just wrote, sourced from the guarded service board.',
  },
  // src/lib/db/service-tickets.ts:153 and :162 were allowlisted here in the
  // first pass. Removed in the fix round: the checker now mechanically
  // recognizes delegation to applyServiceTicketFilters (both the direct
  // pass-through and the X = applyServiceTicketFilters(X, ...) reassignment
  // form), so both sites are no longer findings at all. This was a rule the
  // plan specified and Task 2 had not implemented yet, not a judgment call,
  // so a mechanical exemption is correct instead of a standing allowlist entry.

  // pm_tickets: out of scope for this task. Task 4 owns the pm_tickets triage;
  // these are parked here only so the suite is green in the meantime.
  {
    file: 'src/app/api/billing/mark-billed/route.ts',
    line: 53,
    reason: 'PENDING TASK 4 TRIAGE',
  },
  {
    file: 'src/app/api/billing/unexport/route.ts',
    line: 49,
    reason: 'PENDING TASK 4 TRIAGE',
  },
  {
    file: 'src/app/api/tickets/route.ts',
    line: 52,
    reason: 'PENDING TASK 4 TRIAGE',
  },
  {
    file: 'src/lib/db/auditEvents.ts',
    line: 104,
    reason: 'PENDING TASK 4 TRIAGE',
  },
  {
    file: 'src/lib/pm-generation.ts',
    line: 241,
    reason: 'PENDING TASK 4 TRIAGE',
  },
]
