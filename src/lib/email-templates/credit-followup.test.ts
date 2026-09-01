import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderCreditFollowupEmail, type CreditFollowupItem } from './credit-followup'

const blocked = (over: Partial<CreditFollowupItem> = {}): CreditFollowupItem => ({
  customerName: 'CAHAWBA CHRISTIAN ACADEMY',
  accountNumber: '2261',
  orderLabel: 'PM Jun 2026 — TENNANT T350',
  status: 'blocked',
  blockReason: 'account over 90 days',
  decidedByName: 'Tamara',
  daysWaiting: 64,
  href: 'https://app.example.com/tickets/pm-1',
  ...over,
})

test('subject leads with the count and the worst age', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked(), blocked({ daysWaiting: 3 })],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.match(e.subject, /2 orders waiting/)
  assert.match(e.subject, /oldest 64d/)
})

test('subject stays singular for one order', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked()],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.match(e.subject, /1 order waiting/)
})

test('names the customer, order, age and AR reason in both bodies', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked()],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  for (const body of [e.html, e.text]) {
    assert.ok(body.includes('CAHAWBA CHRISTIAN ACADEMY'), 'customer missing')
    assert.ok(body.includes('account over 90 days'), 'block reason missing')
    assert.ok(body.includes('64d'), 'age missing')
    assert.ok(body.includes('https://app.example.com/tickets/pm-1'), 'deep link missing')
  }
})

test('separates blocked orders from ones AR has not answered', () => {
  const e = renderCreditFollowupEmail({
    items: [
      blocked(),
      blocked({
        customerName: 'ACME',
        status: 'pending',
        blockReason: null,
        decidedByName: null,
        daysWaiting: 9,
      }),
    ],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.ok(e.text.includes('need a manager to release'), 'blocked heading missing')
  assert.ok(e.text.includes('waiting on an AR credit decision'), 'pending heading missing')
  assert.ok(e.text.includes('ACME'), 'pending order missing')
})

test('omits an empty group rather than printing a bare heading', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked()],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.ok(!e.html.includes('Waiting on an AR credit decision'))
})

// Block reasons are typed by AR into a free-text box and land in an HTML email.
test('escapes a block reason that contains markup', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked({ blockReason: '<script>alert(1)</script>' })],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.ok(!e.html.includes('<script>'), 'unescaped markup reached the html')
  assert.ok(e.html.includes('&lt;script&gt;'))
})

test('renders an order with no block reason recorded', () => {
  const e = renderCreditFollowupEmail({
    items: [blocked({ blockReason: null, decidedByName: null })],
    queueUrl: 'https://app.example.com/credit-review',
    settings: { company_name: 'CallBoard' },
  })
  assert.ok(e.text.includes('64d blocked'))
  assert.ok(!e.text.includes('undefined'))
  assert.ok(!e.html.includes('undefined'))
})
