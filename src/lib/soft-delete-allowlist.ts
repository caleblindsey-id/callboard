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

  // pm_tickets triage (Task 4, 2026-07-28):
  {
    file: 'src/app/api/billing/mark-billed/route.ts',
    line: 53,
    reason:
      'Acts on an explicit id set posted from the PM Awaiting Invoice board (getPmAwaitingInvoiceTickets in src/lib/db/tickets.ts, which already filters .is(\'deleted_at\', null)). The route re-checks status and billing_exported before writing. Mirrors the service-ticket mark-billed route allowlisted for the same reason.',
  },
  {
    file: 'src/app/api/billing/unexport/route.ts',
    line: 49,
    reason:
      'Acts on an explicit id set posted from the same guarded PM Awaiting Invoice board as mark-billed. The route re-checks status and billing_exported before writing. Mirrors the service-ticket unexport route allowlisted for the same reason.',
  },
  {
    file: 'src/app/api/tickets/route.ts',
    line: 52,
    reason:
      'Deliberately deleted_at-inclusive. This duplicate check (same equipment + month/year, not billed) exists to keep the manual create path consistent with the rest of the PM lifecycle, which treats a soft-deleted ticket as still occupying its slot: pm-generation.ts:241 uses the identical deleted_at-inclusive pre-fetch on purpose to block auto-regeneration, and the DB-level UNIQUE(pm_schedule_id, month, year) constraint (migration 004) is not partial on deleted_at, so tickets/[id]/restore/route.ts has to handle the resulting 23505 as an expected case. If this one site alone excluded deleted rows, a manager could delete a mis-created PM and manually recreate a duplicate that batch generation and restore would still refuse, which is the asymmetry this guard exists to catch, not fix.',
  },
  {
    file: 'src/lib/db/auditEvents.ts',
    line: 104,
    reason:
      'Same rationale as the service_tickets half of this Promise.all on the next line (already allowlisted): resolving a work order number to ticket ids for the audit trail has to find deleted PM tickets too, or a deleted ticket\'s history stops rendering.',
  },
  {
    file: 'src/lib/pm-generation.ts',
    line: 241,
    reason:
      'Deliberately deleted_at-inclusive per the function\'s own comment: soft-deleted tickets still block regeneration on purpose, so batch generation cannot re-create a duplicate for the same schedule/equipment and month right after a delete. Removing the guard here would also create the schedule-vs-manual asymmetry described at src/app/api/tickets/route.ts:52.',
  },
]
