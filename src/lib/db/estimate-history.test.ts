import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeEstimateHistory,
  type EstimateTicketInput,
  type EstimateLogInput,
} from './estimate-history'

function ticket(over: Partial<EstimateTicketInput> = {}): EstimateTicketInput {
  return {
    id: 't1',
    work_order_number: 100,
    estimate_amount: 300,
    status: 'estimated',
    decline_reason: null,
    estimated_at: '2026-01-01T00:00:00Z',
    problem_description: 'leak',
    ...over,
  }
}

function log(over: Partial<EstimateLogInput> = {}): EstimateLogInput {
  return {
    id: 'l1',
    service_ticket_id: 't1',
    work_order_number: 100,
    estimate_amount: 300,
    outcome: 'declined',
    decline_reason: 'too pricey',
    problem_description: 'leak',
    created_at: '2025-12-01T00:00:00Z',
    ...over,
  }
}

test('maps a ticket row with estimate to a ticket-source row', () => {
  const rows = mergeEstimateHistory([ticket()], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'ticket')
  assert.equal(rows[0].service_ticket_id, 't1')
  assert.equal(rows[0].outcome, 'estimated')
  assert.equal(rows[0].estimate_amount, 300)
  assert.equal(rows[0].description, 'leak')
  assert.equal(rows[0].date, '2026-01-01T00:00:00Z')
  assert.equal(rows[0].key, 't:t1')
})

test('keeps a log snapshot whose ticket is NOT currently declined (superseded by re-quote)', () => {
  // ticket re-quoted and now approved at a different amount; old declined log survives
  const rows = mergeEstimateHistory(
    [ticket({ status: 'approved', estimate_amount: 500 })],
    [log({ estimate_amount: 300 })],
  )
  assert.equal(rows.length, 2)
  const log300 = rows.find((r) => r.source === 'log')
  assert.ok(log300)
  assert.equal(log300.estimate_amount, 300)
  assert.equal(log300.outcome, 'declined')
})

test('dedupes a log snapshot that restates a still-declined ticket at the same amount', () => {
  const rows = mergeEstimateHistory(
    [ticket({ status: 'declined', estimate_amount: 300 })],
    [log({ estimate_amount: 300 })],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'ticket')
})

test('keeps a log snapshot with null service_ticket_id (ticket deleted), no link', () => {
  const rows = mergeEstimateHistory([], [log({ service_ticket_id: null })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'log')
  assert.equal(rows[0].service_ticket_id, null)
})

test('sorts by date desc, null dates last', () => {
  const rows = mergeEstimateHistory(
    [
      ticket({ id: 'old', estimated_at: '2025-01-01T00:00:00Z' }),
      ticket({ id: 'new', estimated_at: '2026-06-01T00:00:00Z' }),
      ticket({ id: 'nodate', estimated_at: null }),
    ],
    [],
  )
  assert.deepEqual(
    rows.map((r) => r.service_ticket_id),
    ['new', 'old', 'nodate'],
  )
})

test('amount float noise does not break dedupe (300.00 vs 300)', () => {
  const rows = mergeEstimateHistory(
    [ticket({ status: 'declined', estimate_amount: 300.0 })],
    [log({ estimate_amount: 300.004 })], // rounds to same cents
  )
  assert.equal(rows.length, 1)
})

test('null amount distinct from 0 in dedupe (declined ticket with null, log with 0)', () => {
  const rows = mergeEstimateHistory(
    [ticket({ status: 'declined', estimate_amount: null })],
    [log({ estimate_amount: 0 })],
  )
  assert.equal(rows.length, 2)
  const ticket0 = rows.find((r) => r.source === 'ticket')
  const log0 = rows.find((r) => r.source === 'log')
  assert.ok(ticket0)
  assert.ok(log0)
  assert.equal(ticket0.estimate_amount, null)
  assert.equal(log0.estimate_amount, 0)
})
