import type { TechLeadStatus, TechLeadType, UserRole } from '@/types/database'
import { MANAGER_ROLES, RESET_ROLES } from '@/types/database'

// Who may edit a tech lead's content fields, given the actor and the lead's
// current state. Pure — no DB — so it can be unit-tested and shared by the
// PATCH route.
//
// Rules:
//   - While `pending`: the submitter (owner) OR any manager role
//     (super_admin/manager/coordinator) may edit. This is the original behavior
//     of PATCH /api/tech-leads/[id].
//   - Past `pending`: only super_admin/manager (RESET_ROLES) may still correct an
//     equipment-sale lead that is `approved` or `match_pending` — e.g. fixing the
//     wrong customer account on an awaiting-match lead (feedback #74). Techs and
//     coordinators cannot. PM leads and terminal states (earned/paid/cancelled/
//     rejected/expired) are never editable here.

export type LeadEditPermission =
  | { allowed: true }
  | { allowed: false; status: 403 | 409; error: string }

export function evaluateLeadEditPermission(params: {
  isOwner: boolean
  role: UserRole
  status: TechLeadStatus
  leadType: TechLeadType
}): LeadEditPermission {
  const { isOwner, role, status, leadType } = params

  const isManager = MANAGER_ROLES.includes(role)
  if (!isOwner && !isManager) {
    return { allowed: false, status: 403, error: 'Forbidden' }
  }

  if (status === 'pending') {
    return { allowed: true }
  }

  // Post-pending correction window — managers only, equipment-sale only, and
  // only while the lead can still earn (approved / match_pending).
  const isResetManager = RESET_ROLES.includes(role)
  if (
    isResetManager &&
    leadType === 'equipment_sale' &&
    (status === 'approved' || status === 'match_pending')
  ) {
    return { allowed: true }
  }

  return {
    allowed: false,
    status: 409,
    error: 'This lead has already been reviewed and can no longer be edited.',
  }
}
