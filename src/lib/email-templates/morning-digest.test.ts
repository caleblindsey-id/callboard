import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMorningDigestEmail } from './morning-digest'
import type { SectionResult } from '@/lib/digest/types'

const row = (key: string, title: string) => ({
  entityKey: key,
  title,
  subtitle: 'Acme Co',
  meta: '9d since last touch',
  deepLink: '/service/abc',
  badge: { label: 'Open', fg: '#1e40af', bg: '#eff6ff' },
})

const base = {
  appUrl: 'https://callboard.services',
  dateLabel: 'Aug 20',
  companyName: 'CallBoard',
}

test('empty sections are omitted from the body', () => {
  const results: SectionResult[] = [
    { ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] },
    { ok: true, sectionKey: 'idle_service', rows: [] },
  ]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('Overdue PMs'))
  assert.ok(!html.includes('Idle service tickets'))
})

test('an owner block with no surviving sections is omitted entirely', () => {
  const results: SectionResult[] = [
    { ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] },
    { ok: true, sectionKey: 'warranty_to_file', rows: [] },
  ]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('Service Execution'))
  assert.ok(!html.includes('Customer Chases'))
})

test('a section over TOP_N shows a more row', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`pm:${i}`, `WO #${i}`))
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('4 more'), 'must show the remainder beyond TOP_N of 5')
})

test('the section count is the true count, not the truncated one', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`pm:${i}`, `WO #${i}`))
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('>9<') || html.includes('9</'), 'section header must show 9, not 5')
})

test('a failed section renders a failure row rather than vanishing', () => {
  const results: SectionResult[] = [{ ok: false, sectionKey: 'overdue_pms', message: 'timeout' }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('Overdue PMs'), 'a failed section must still show its heading')
  assert.ok(/could not load/i.test(html))
})

test('the headline dedupes across overlapping sections', () => {
  const results: SectionResult[] = [
    { ok: true, sectionKey: 'ready_to_bill', rows: [row('svc:a', 'WO #1'), row('svc:b', 'WO #2')] },
    { ok: true, sectionKey: 'po_gated', rows: [row('svc:a', 'WO #1')] },
  ]
  const { subject } = renderMorningDigestEmail({ ...base, results })
  assert.ok(subject.includes('2 items'), `expected 2 distinct, got: ${subject}`)
})

test('every text-bearing cell carries a font-family, because Word does not inherit it', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  const tdCount = (html.match(/<td/g) ?? []).length
  const fontCount = (html.match(/font-family/g) ?? []).length
  assert.ok(
    fontCount >= tdCount * 0.5,
    `only ${fontCount} font-family declarations for ${tdCount} cells`
  )
})

test('the font stack leads with Segoe UI, not -apple-system', () => {
  // A stack leading with -apple-system/BlinkMacSystemFont makes the Word
  // engine fall back to Times across the whole email.
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(!html.includes('-apple-system'))
  assert.ok(html.includes("'Segoe UI'"))
})

test('no VML, which never fires reliably and is not needed for a bgcolor button', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(!html.includes('v:roundrect'))
})

test('every CSS background is paired with a bgcolor attribute', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  const bgStyles = (html.match(/background:#/g) ?? []).length
  const bgAttrs = (html.match(/bgcolor=/g) ?? []).length
  assert.ok(bgAttrs >= bgStyles * 0.8, `${bgAttrs} bgcolor attrs for ${bgStyles} background styles`)
})

test('deep links are absolute, since an email has no origin', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(html.includes('https://callboard.services/service/abc'))
  assert.ok(!/href="\/[a-z]/.test(html), 'no root-relative hrefs')
})

test('user content is HTML escaped', () => {
  const nasty = {
    ...row('pm:1', 'WO #1'),
    subtitle: '<script>alert(1)</script>',
  }
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [nasty] }]
  const { html } = renderMorningDigestEmail({ ...base, results })
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('no dashes anywhere in the rendered copy', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { html, text, subject } = renderMorningDigestEmail({ ...base, results })
  for (const s of [html, text, subject]) {
    assert.ok(!s.includes('—') && !s.includes('–'), 'rendered copy contains a dash')
  }
})

test('a plain text alternative is produced', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { text } = renderMorningDigestEmail({ ...base, results })
  assert.ok(text.includes('Overdue PMs'))
  assert.ok(text.includes('assign a tech and schedule'))
  assert.ok(!text.includes('<td'))
})

test('test sends are marked so a real digest is never mistaken for one', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'overdue_pms', rows: [row('pm:1', 'WO #1')] }]
  const { subject } = renderMorningDigestEmail({ ...base, results, isTest: true })
  assert.ok(subject.startsWith('[TEST]'))
})

test('an unknown section key is ignored rather than throwing', () => {
  const results: SectionResult[] = [{ ok: true, sectionKey: 'not_a_real_section', rows: [row('pm:1', 'WO #1')] }]
  assert.doesNotThrow(() => renderMorningDigestEmail({ ...base, results }))
})
