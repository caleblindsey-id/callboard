import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupedCount } from './dedupe'
import { entityKey, type SectionResult } from './types'

// The headline counts DISTINCT entities, not the sum of section counts.
// Sections legitimately overlap: a completed ticket for a PO-required customer
// is both "ready to bill" and "waiting on a PO", and both actions are real.
// The 2026-08-20 audit measured 127 summed against 107 distinct.

const row = (key: string) => ({
  entityKey: key,
  title: '',
  subtitle: '',
  meta: '',
  deepLink: '',
  badge: { label: '', fg: '', bg: '' },
})

test('counts a ticket appearing in two sections only once', () => {
  const results: SectionResult[] = [
    {
      ok: true,
      sectionKey: 'ready_to_bill',
      rows: [row(entityKey('svc', 'a')), row(entityKey('svc', 'b'))],
    },
    { ok: true, sectionKey: 'po_gated', rows: [row(entityKey('svc', 'a'))] },
  ]
  assert.equal(dedupedCount(results), 2)
})

test('a service ticket and a PM ticket sharing an id are distinct', () => {
  const results: SectionResult[] = [
    {
      ok: true,
      sectionKey: 'ready_to_bill',
      rows: [row(entityKey('svc', 'a')), row(entityKey('pm', 'a'))],
    },
  ]
  assert.equal(dedupedCount(results), 2)
})

test('failed sections contribute nothing to the count', () => {
  const results: SectionResult[] = [
    { ok: true, sectionKey: 'a', rows: [row(entityKey('svc', 'a'))] },
    { ok: false, sectionKey: 'b', message: 'boom' },
  ]
  assert.equal(dedupedCount(results), 1)
})

test('all sections failing yields zero, which the subject must not render as calm', () => {
  const results: SectionResult[] = [{ ok: false, sectionKey: 'b', message: 'boom' }]
  assert.equal(dedupedCount(results), 0)
})
