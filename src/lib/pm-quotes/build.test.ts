import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuoteLines, frequencyLabel, type QuotableTicket } from './build'

function ticket(over: Partial<QuotableTicket> = {}): QuotableTicket {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    work_order_number: 988,
    customer_id: 6051,
    equipment: {
      make: 'TENNANT',
      model: 'T300E',
      serial_number: '10999597',
      description: 'FLOOR SCRUBBER',
    },
    pm_schedules: { billing_type: 'flat_rate', flat_rate: 200, interval_months: 6 },
    ...over,
  }
}

test('frequencyLabel maps the known intervals and falls back sanely', () => {
  assert.equal(frequencyLabel(1), 'Monthly')
  assert.equal(frequencyLabel(6), 'Semi-Annual')
  assert.equal(frequencyLabel(12), 'Annual')
  assert.equal(frequencyLabel(5), 'Every 5 mo')
  assert.equal(frequencyLabel(null), '—')
})

test('buildQuoteLines snapshots each ticket and totals them', () => {
  const res = buildQuoteLines(
    [
      ticket(),
      ticket({
        id: 'bbbbbbbb-1111-2222-3333-444444444444',
        work_order_number: 989,
        equipment: {
          make: 'TENNANT',
          model: 'T300E',
          serial_number: '10988806',
          description: 'FLOOR SCRUBBER ORBITAL',
        },
      }),
    ],
    2
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.subtotal, 400)
  assert.equal(res.customerId, 6051)
  assert.deepEqual(
    res.lines.map((l) => [l.work_order_number, l.equipment_label, l.serial_number, l.amount]),
    [
      [988, 'TENNANT T300E', '10999597', 200],
      [989, 'TENNANT T300E', '10988806', 200],
    ]
  )
})

test('buildQuoteLines sorts by work order number and stamps sort_order', () => {
  const res = buildQuoteLines(
    [
      ticket({ id: 'b', work_order_number: 989 }),
      ticket({ id: 'a', work_order_number: 988 }),
    ],
    2
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.deepEqual(res.lines.map((l) => l.work_order_number), [988, 989])
  assert.deepEqual(res.lines.map((l) => l.sort_order), [0, 1])
})

test('buildQuoteLines rejects a selection spanning two customers', () => {
  const res = buildQuoteLines([ticket(), ticket({ id: 'b', customer_id: 7000 })], 2)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 400)
  assert.match(res.error, /same customer/i)
})

test('buildQuoteLines rejects non-flat-rate schedules by work order number', () => {
  const res = buildQuoteLines(
    [
      ticket(),
      ticket({
        id: 'b',
        work_order_number: 990,
        pm_schedules: { billing_type: 'time_and_materials', flat_rate: null, interval_months: 3 },
      }),
    ],
    2
  )
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 400)
  assert.match(res.error, /WO-990/)
  assert.doesNotMatch(res.error, /WO-988/)
})

test('buildQuoteLines rejects a zero or missing flat rate', () => {
  for (const flat of [0, null, -5]) {
    const res = buildQuoteLines(
      [ticket({ pm_schedules: { billing_type: 'flat_rate', flat_rate: flat, interval_months: 6 } })],
      1
    )
    assert.equal(res.ok, false, `flat_rate ${flat} should not be quotable`)
  }
})

test('buildQuoteLines fails the whole request when a ticket went missing', () => {
  const res = buildQuoteLines([ticket()], 2)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 409)
})

test('buildQuoteLines rejects an empty selection', () => {
  const res = buildQuoteLines([], 0)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 400)
})
