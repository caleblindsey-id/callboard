import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRouteActive } from './nav-active'

// A representative slice of the real nav, including the one nested pair.
const ROUTES = ['/', '/billing', '/billing/po-follow-up', '/tech-payouts', '/analytics', '/service', '/tickets']

test('dashboard is active only on the exact root path', () => {
  assert.equal(isRouteActive('/', '/', ROUTES), true)
  assert.equal(isRouteActive('/', '/billing', ROUTES), false)
  assert.equal(isRouteActive('/', '/service/abc', ROUTES), false)
})

test('a top-level entry is active on its own path and its detail pages', () => {
  assert.equal(isRouteActive('/service', '/service', ROUTES), true)
  assert.equal(isRouteActive('/service', '/service/9f3a', ROUTES), true)
  assert.equal(isRouteActive('/tickets', '/service', ROUTES), false)
})

test('the chase page lights Billing Chase and NOT its parent Billing', () => {
  assert.equal(isRouteActive('/billing/po-follow-up', '/billing/po-follow-up', ROUTES), true)
  assert.equal(isRouteActive('/billing', '/billing/po-follow-up', ROUTES), false)
})

test('the billing page itself still lights Billing, not Billing Chase', () => {
  assert.equal(isRouteActive('/billing', '/billing', ROUTES), true)
  assert.equal(isRouteActive('/billing/po-follow-up', '/billing', ROUTES), false)
})

test('a child route no nav entry owns still lights its parent', () => {
  assert.equal(isRouteActive('/billing', '/billing/some-future-page', ROUTES), true)
})

test('a route that merely shares a name prefix is unaffected', () => {
  // '/tech-payouts' must not be treated as nested under a hypothetical '/tech'.
  assert.equal(isRouteActive('/tech-payouts', '/tech-payouts', ROUTES), true)
  assert.equal(isRouteActive('/analytics', '/tech-payouts', ROUTES), false)
})
