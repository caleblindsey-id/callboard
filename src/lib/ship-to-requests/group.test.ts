import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupShipToRequests, normalizeNote, groupKey } from './group'
import type { ShipToRequestWithJoins } from '@/lib/db/ship-to-requests'

// Fixtures mirror the real pending backlog on 2026-08-24 (prod, 14 rows).

const req = (
  id: number,
  customer_id: number,
  note: string,
  requested_at: string,
  tech = 'Richard Bryant'
): ShipToRequestWithJoins =>
  ({
    id,
    customer_id,
    requested_by: 'u1',
    pm_ticket_id: null,
    equipment_id: null,
    service_ticket_id: null,
    note,
    status: 'pending',
    requested_at,
    resolved_at: null,
    resolved_ship_to_id: null,
    resolved_by: null,
    customer: { id: customer_id, name: 'HEALTHSOUTH' },
    requested_by_user: { name: tech },
    equipment: null,
  }) as unknown as ShipToRequestWithJoins

test('normalizeNote ignores case and punctuation', () => {
  assert.equal(
    normalizeNote('3800 ridgeway Dr., Birmingham, AL 35209'),
    normalizeNote('3800 Ridgeway Dr., Birmingham, AL 35209')
  )
})

test('collapses the five real HEALTHSOUTH duplicates into one group', () => {
  // Prod ids 4-8: same tech, same day, differing only in "ridgeway"/"Ridgeway".
  const rows = [
    req(4, 900, '3800 ridgeway Dr., Birmingham, AL 35209', '2026-07-09T10:00:00Z'),
    req(5, 900, '3800 Ridgeway Dr., Birmingham, AL 35209', '2026-07-09T10:05:00Z'),
    req(6, 900, '3800 Ridgeway Dr., Birmingham, AL 35209', '2026-07-09T10:06:00Z'),
    req(7, 900, '3800 Ridgeway Dr., Birmingham, AL 35209', '2026-07-09T10:07:00Z'),
    req(8, 900, '3800 Ridgeway Dr., Birmingham, AL 35209', '2026-07-09T10:08:00Z'),
  ]
  const groups = groupShipToRequests(rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].count, 5)
  assert.deepEqual(groups[0].ids, [4, 5, 6, 7, 8])
})

test('the group ages from the OLDEST request, so re-asking does not reset the clock', () => {
  const groups = groupShipToRequests([
    req(8, 900, '3800 Ridgeway Dr.', '2026-07-09T10:08:00Z'),
    req(4, 900, '3800 ridgeway dr.', '2026-07-09T10:00:00Z'),
  ])
  assert.equal(groups[0].oldestRequestedAt, '2026-07-09T10:00:00Z')
  assert.equal(groups[0].primary.id, 4)
})

test('the same address for two different customers stays two groups', () => {
  const groups = groupShipToRequests([
    req(1, 900, '1500 Bulldog Blvd', '2026-07-21T10:00:00Z'),
    req(2, 901, '1500 Bulldog Blvd', '2026-07-21T10:00:00Z'),
  ])
  assert.equal(groups.length, 2)
})

test('groupKey combines customer and normalized note', () => {
  assert.equal(groupKey({ customer_id: 7, note: 'A b,  C' }), '7::a b c')
})

test('groups are ordered oldest first', () => {
  const groups = groupShipToRequests([
    req(14, 903, '801 Commercial St SE', '2026-08-20T10:00:00Z'),
    req(1, 902, 'CRESTLINE ELEMENTARY SCHOOL', '2026-05-28T14:37:00Z'),
  ])
  assert.deepEqual(
    groups.map((g) => g.primary.id),
    [1, 14]
  )
})

test('distinct requesters are listed once each, oldest first', () => {
  const groups = groupShipToRequests([
    req(2, 904, 'same place', '2026-06-02T10:00:00Z', 'Jacob Essmon'),
    req(3, 904, 'same place', '2026-06-03T10:00:00Z', 'Kayla Parrish'),
    req(4, 904, 'same place', '2026-06-04T10:00:00Z', 'Jacob Essmon'),
  ])
  assert.deepEqual(groups[0].requesterNames, ['Jacob Essmon', 'Kayla Parrish'])
})

test('an empty queue yields no groups', () => {
  assert.deepEqual(groupShipToRequests([]), [])
})
