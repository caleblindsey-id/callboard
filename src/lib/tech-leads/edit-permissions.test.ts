import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateLeadEditPermission } from './edit-permissions'
import type { TechLeadStatus, TechLeadType, UserRole } from '@/types/database'

function evalPerm(overrides: {
  isOwner?: boolean
  role?: UserRole
  status?: TechLeadStatus
  leadType?: TechLeadType
} = {}) {
  return evaluateLeadEditPermission({
    isOwner: false,
    role: 'manager',
    status: 'pending',
    leadType: 'equipment_sale',
    ...overrides,
  })
}

// --- pending: owner or any manager role may edit (unchanged behavior) ---

test('owner may edit their own pending lead', () => {
  assert.deepEqual(evalPerm({ isOwner: true, role: 'technician', status: 'pending' }), { allowed: true })
})

test('coordinator may edit a pending lead', () => {
  assert.deepEqual(evalPerm({ role: 'coordinator', status: 'pending' }), { allowed: true })
})

test('manager may edit a pending lead', () => {
  assert.deepEqual(evalPerm({ role: 'manager', status: 'pending' }), { allowed: true })
})

// --- authz: a non-owner, non-manager is forbidden outright ---

test('a non-owner technician is forbidden (403)', () => {
  const r = evalPerm({ isOwner: false, role: 'technician', status: 'pending' })
  assert.equal(r.allowed, false)
  if (r.allowed) return
  assert.equal(r.status, 403)
})

// --- post-pending correction window (feedback #74) ---

test('super_admin may edit an approved equipment-sale lead', () => {
  assert.deepEqual(evalPerm({ role: 'super_admin', status: 'approved' }), { allowed: true })
})

test('manager may edit a match_pending equipment-sale lead', () => {
  assert.deepEqual(evalPerm({ role: 'manager', status: 'match_pending' }), { allowed: true })
})

test('coordinator may NOT edit an approved lead (409 — not a RESET role)', () => {
  const r = evalPerm({ role: 'coordinator', status: 'approved' })
  assert.equal(r.allowed, false)
  if (r.allowed) return
  assert.equal(r.status, 409)
})

test('the owner tech may NOT edit their lead once approved (409 — owns it, but past pending)', () => {
  const r = evalPerm({ isOwner: true, role: 'technician', status: 'approved' })
  assert.equal(r.allowed, false)
  if (r.allowed) return
  // Owner passes the authz check, then the past-pending gate closes it — same
  // "can no longer be edited" 409 the tech sees today.
  assert.equal(r.status, 409)
})

test('managers may NOT edit an approved PM lead (equipment-sale only past pending)', () => {
  const r = evalPerm({ role: 'manager', status: 'approved', leadType: 'pm' })
  assert.equal(r.allowed, false)
  if (r.allowed) return
  assert.equal(r.status, 409)
})

// --- terminal states are never editable ---

for (const status of ['earned', 'paid', 'cancelled', 'rejected', 'expired'] as TechLeadStatus[]) {
  test(`super_admin may NOT edit a ${status} lead (409)`, () => {
    const r = evalPerm({ role: 'super_admin', status })
    assert.equal(r.allowed, false)
    if (r.allowed) return
    assert.equal(r.status, 409)
  })
}
