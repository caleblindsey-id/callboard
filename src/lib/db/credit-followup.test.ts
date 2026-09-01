import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getOpenCreditReviewsForFollowup } from './credit-followup'
import type { DigestDb } from '@/lib/digest/types'

// Minimal stand-in for the PostgREST chain the function uses:
// .from(...).select(...).in(...).order(...) resolved as a promise.
// The row shapes below mirror what prod actually returns -- embedded
// to-one relations come back as objects, and the unused side is null.
function stubDb(rows: unknown[], error: unknown = null): DigestDb {
  const result = Promise.resolve({ data: rows, error })
  const chain = {
    select: () => chain,
    in: () => chain,
    order: () => result,
  }
  return { from: () => chain } as unknown as DigestDb
}

const pmRow = (over: Record<string, unknown> = {}) => ({
  id: 'rev-pm',
  status: 'blocked',
  created_at: '2026-06-28T00:00:00Z',
  decided_at: '2026-06-29T00:00:00Z',
  block_reason: 'account over 90 days',
  decided_by_name: 'Tamara',
  reminder_count: 2,
  last_reminded_at: '2026-08-30T00:00:00Z',
  ticket_type: 'pm',
  customer_id: 1009,
  customers: { name: 'SYLACAUGA HEALTH CARE', account_number: '2261' },
  pm_tickets: {
    id: 'pm-1',
    month: 7,
    year: 2026,
    deleted_at: null,
    equipment: { make: 'TENNANT', model: 'T350' },
  },
  service_tickets: null,
  ...over,
})

const svcRow = (over: Record<string, unknown> = {}) => ({
  id: 'rev-svc',
  status: 'pending',
  created_at: '2026-08-20T00:00:00Z',
  decided_at: null,
  block_reason: null,
  decided_by_name: null,
  reminder_count: 0,
  last_reminded_at: null,
  ticket_type: 'service',
  customer_id: 3340,
  customers: { name: "CHILDREN'S HOSPITAL", account_number: '5636' },
  pm_tickets: null,
  service_tickets: { id: 'svc-1', work_order_number: 1098, deleted_at: null },
  ...over,
})

test('maps a PM review to a labelled candidate', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(stubDb([pmRow()]))
  assert.equal(r.id, 'rev-pm')
  assert.equal(r.status, 'blocked')
  assert.equal(r.orderLabel, 'PM Jul 2026 — TENNANT T350')
  assert.equal(r.customerName, 'SYLACAUGA HEALTH CARE')
  assert.equal(r.accountNumber, '2261')
  assert.equal(r.blockReason, 'account over 90 days')
  assert.equal(r.decidedAt, '2026-06-29T00:00:00Z')
  assert.equal(r.reminderCount, 2)
  assert.equal(r.lastRemindedAt, '2026-08-30T00:00:00Z')
  assert.equal(r.ticketPath, '/tickets/pm-1')
  assert.equal(r.ticketType, 'pm')
  assert.equal(r.ticketId, 'pm-1')
})

test('maps a service review to a WO-labelled candidate', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(stubDb([svcRow()]))
  assert.equal(r.orderLabel, 'Service WO-1098')
  assert.equal(r.ticketPath, '/service/svc-1')
  assert.equal(r.ticketType, 'service')
  assert.equal(r.ticketId, 'svc-1')
})

test('handles a service order with no work order number yet', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(
    stubDb([svcRow({ service_tickets: { id: 'svc-2', work_order_number: null, deleted_at: null } })])
  )
  assert.equal(r.orderLabel, 'Service order')
})

test('labels a PM whose equipment record is missing', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(
    stubDb([pmRow({ pm_tickets: { id: 'pm-3', month: 1, year: 2026, deleted_at: null, equipment: null } })])
  )
  assert.equal(r.orderLabel, 'PM Jan 2026')
})

// The case npm test's soft-delete scanner structurally cannot catch: the ticket
// arrives nested inside a credit_reviews row, so there is no pm_tickets /
// service_tickets .from() chain for it to flag. Both blocked reviews in the dev
// snapshot are exactly this -- deleted PM tickets whose review row is still
// 'blocked' -- and without the filter the cron would chase managers about them
// every few days forever, since nothing else will ever clear them.
test('drops a review whose PM ticket was soft-deleted', async () => {
  const rows = await getOpenCreditReviewsForFollowup(
    stubDb([pmRow({ pm_tickets: { id: 'pm-x', month: 5, year: 2026, deleted_at: '2026-06-16T21:20:04Z', equipment: null } })])
  )
  assert.deepEqual(rows, [])
})

test('drops a review whose service ticket was soft-deleted', async () => {
  const rows = await getOpenCreditReviewsForFollowup(
    stubDb([svcRow({ service_tickets: { id: 'svc-x', work_order_number: 42, deleted_at: '2026-07-01T00:00:00Z' } })])
  )
  assert.deepEqual(rows, [])
})

test('drops a review whose ticket row is missing entirely', async () => {
  const rows = await getOpenCreditReviewsForFollowup(stubDb([pmRow({ pm_tickets: null })]))
  assert.deepEqual(rows, [])
})

test('keeps the live reviews and drops only the deleted ones', async () => {
  const rows = await getOpenCreditReviewsForFollowup(
    stubDb([
      pmRow({ pm_tickets: { id: 'pm-del', month: 5, year: 2026, deleted_at: '2026-06-16T00:00:00Z', equipment: null } }),
      svcRow(),
    ])
  )
  assert.deepEqual(rows.map((r) => r.id), ['rev-svc'])
})

test('tolerates an embedded relation returned as a one-element array', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(
    stubDb([svcRow({
      customers: [{ name: 'ACME', account_number: '1' }],
      service_tickets: [{ id: 'svc-9', work_order_number: 7, deleted_at: null }],
    })])
  )
  assert.equal(r.customerName, 'ACME')
  assert.equal(r.orderLabel, 'Service WO-7')
})

test('falls back to a placeholder when the customer join is empty', async () => {
  const [r] = await getOpenCreditReviewsForFollowup(stubDb([svcRow({ customers: null })]))
  assert.equal(r.customerName, 'Unknown')
  assert.equal(r.accountNumber, null)
})

test('throws when the query fails rather than reporting an empty queue', async () => {
  await assert.rejects(() => getOpenCreditReviewsForFollowup(stubDb([], { message: 'boom' })))
})
