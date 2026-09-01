import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideAceEdit, canStaffEditAceEntries, isEditableAceStatus } from './edit-policy'
import type { AceLaborStatus, UserRole } from '@/types/database'

const TECH = { id: 'tech-1', role: 'technician' as UserRole }
const OTHER_TECH = { id: 'tech-2', role: 'technician' as UserRole }
const MANAGER = { id: 'mgr-1', role: 'manager' as UserRole }
const SUPER = { id: 'sa-1', role: 'super_admin' as UserRole }
const COORDINATOR = { id: 'coord-1', role: 'coordinator' as UserRole }

const entry = (status: AceLaborStatus, techId = TECH.id) => ({ tech_id: techId, status })

const ALL_STATUSES: AceLaborStatus[] = ['pending', 'approved', 'rejected', 'paid']

test('the submitting tech can still edit their own pending entry', () => {
  const d = decideAceEdit(TECH, entry('pending'))
  assert.deepEqual(d, { allowed: true, asStaff: false, resubmits: false })
})

test('editing a rejected entry resubmits it', () => {
  assert.deepEqual(decideAceEdit(TECH, entry('rejected')), {
    allowed: true, asStaff: false, resubmits: true,
  })
  // A manager fixing a rejection they made puts it back in the queue too,
  // which is how a mistaken rejection gets undone.
  assert.deepEqual(decideAceEdit(MANAGER, entry('rejected')), {
    allowed: true, asStaff: true, resubmits: true,
  })
})

test('a manager and a super_admin can edit another tech\'s pending entry', () => {
  // The point of feedback #93: correct it in review instead of rejecting.
  for (const staff of [MANAGER, SUPER]) {
    assert.deepEqual(decideAceEdit(staff, entry('pending')), {
      allowed: true, asStaff: true, resubmits: false,
    })
  }
})

test('a tech cannot edit an entry they did not submit', () => {
  assert.deepEqual(decideAceEdit(OTHER_TECH, entry('pending')), {
    allowed: false, reason: 'forbidden',
  })
  // Forbidden wins over status: a stranger must not learn the status from a 409.
  assert.deepEqual(decideAceEdit(OTHER_TECH, entry('paid')), {
    allowed: false, reason: 'forbidden',
  })
})

test('a coordinator is read-only on the ACE queue', () => {
  // Coordinators reach /tech-payouts via MANAGER_ROLES but hold no write
  // rights on ace_labor_entries (RLS ace_labor_update, migration 139).
  assert.equal(canStaffEditAceEntries(COORDINATOR.role), false)
  assert.deepEqual(decideAceEdit(COORDINATOR, entry('pending')), {
    allowed: false, reason: 'forbidden',
  })
})

test('approved and paid entries are closed to everyone', () => {
  // rate_value_at_approval is snapshotted at approval and a paid entry may sit
  // in a locked payout period — an edit there would move a settled number.
  for (const status of ['approved', 'paid'] as AceLaborStatus[]) {
    assert.equal(isEditableAceStatus(status), false, status)
    for (const actor of [TECH, MANAGER, SUPER]) {
      assert.deepEqual(
        decideAceEdit(actor, entry(status)),
        { allowed: false, reason: 'status' },
        `${actor.role} -> ${status}`,
      )
    }
  }
})

test('only pending and rejected are editable, across every status', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isEditableAceStatus(status),
      status === 'pending' || status === 'rejected',
      status,
    )
  }
})

test('a null role is never staff and never edits a stranger\'s entry', () => {
  assert.equal(canStaffEditAceEntries(null), false)
  assert.deepEqual(decideAceEdit({ id: 'x', role: null }, entry('pending')), {
    allowed: false, reason: 'forbidden',
  })
})
