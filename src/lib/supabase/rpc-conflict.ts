/**
 * Recognize a business-logic conflict raised by one of our SECURITY DEFINER RPCs.
 *
 * Our plpgsql functions signal "the data is not in the state you expected" by
 * raising a named exception — OPTIMISTIC_LOCK, STATUS_CONFLICT — which the
 * calling route turns into a 409. Matching those correctly is fiddly for one
 * reason, and it is worth stating plainly because it cost a production bug:
 *
 * **Never match on ERRCODE 40001.** That is `serialization_failure`, the class a
 * client is *supposed* to retry automatically, and the Supabase stack does. A
 * refusal dressed as 40001 is retried until the gateway gives up, so the caller
 * gets a ~45s 504 and the 409 below never runs. Measured on dev before
 * migration 157: the same function returned a 22023 branch in 284ms and was
 * still spinning on the 40001 branch after 70 seconds. Migration 157 moved both
 * of ours to P0001 (raise_exception, the plpgsql default).
 *
 * P0001 is generic — every business raise in every function shares it — so the
 * raised NAME is what identifies which conflict this is. That is the primary
 * match here.
 *
 * The legacy `40001` check stays for two reasons: it keeps this correct against
 * a database that has not had migration 157 applied yet (so the deploy and the
 * migration need not land together), and once every database has it, a genuine
 * serialization failure is itself a "someone changed this underneath you"
 * condition that a 409 describes accurately.
 */
export function isRpcConflict(
  error: { code?: string | null; message?: string | null } | null | undefined,
  raisedName: string,
): boolean {
  if (!error) return false
  if (typeof error.message === 'string' && error.message.trim() === raisedName) {
    return true
  }
  return error.code === '40001'
}

/** The optimistic-lock refusal from fn_update_parts_queue. */
export function isOptimisticLockError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  return isRpcConflict(error, 'OPTIMISTIC_LOCK')
}

/** The already-approved refusal from fn_approve_tech_lead_email. */
export function isStatusConflictError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  return isRpcConflict(error, 'STATUS_CONFLICT')
}
