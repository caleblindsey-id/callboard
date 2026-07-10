import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TECH_LEAD_PIPELINE_LABEL } from './status-labels'

// Pins the dashboard-2 fix: the "Tech Leads" pipeline card must read the DB
// status literally (pending = still awaiting office review = "Submitted";
// approved = office signed off, awaiting match/equipment = "Approved").
// A future edit that swaps these back onto the wrong tile should fail here
// before it ships.
test('pending status is labeled Submitted (tech submitted, awaiting office review)', () => {
  assert.equal(TECH_LEAD_PIPELINE_LABEL.pending, 'Submitted')
})

test('approved status is labeled Approved (office approved, awaiting match/equipment)', () => {
  assert.equal(TECH_LEAD_PIPELINE_LABEL.approved, 'Approved')
})

test('match_pending status is labeled Match Pending', () => {
  assert.equal(TECH_LEAD_PIPELINE_LABEL.match_pending, 'Match Pending')
})

test('labels are distinct — no two pipeline statuses render the same word', () => {
  const values = Object.values(TECH_LEAD_PIPELINE_LABEL)
  assert.equal(new Set(values).size, values.length)
})
