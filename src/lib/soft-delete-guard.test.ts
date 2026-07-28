import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractChains } from './soft-delete-guard'

test('extracts a simple chain with its table and methods', () => {
  const src = `
    const { data } = await supabase
      .from('service_tickets')
      .select('id')
      .eq('status', 'open')
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].table, 'service_tickets')
  assert.deepEqual(chains[0].methods.map((m) => m.name), ['select', 'eq'])
})

test('survives a multi-line template-literal select, which defeated the grep approach', () => {
  const src = `
    const { data } = await supabase
      .from('service_tickets')
      .select(\`
        id,
        work_order_number,
        customers ( name )
      \`)
      .is('deleted_at', null)
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.deepEqual(chains[0].methods.map((m) => m.name), ['select', 'is'])
})

test('captures string-literal args and marks non-literal args', () => {
  const src = `supabase.from('pm_tickets').select('id').eq('id', ticketId)`
  const chains = extractChains(src, 'probe.ts')
  assert.deepEqual(chains[0].methods[1].args, ['id', '<expr>'])
})

test('reports a null table for a dynamic table name', () => {
  const src = `supabase.from(table).select('id').eq('id', x)`
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains[0].table, null)
})

test('ignores Array.from and Buffer.from, which are not queries', () => {
  const src = `
    const a = Array.from(set).map((x) => x)
    const b = Buffer.from(raw, 'base64')
  `
  assert.equal(extractChains(src, 'probe.ts').length, 0)
})

test('records the variable a chain is assigned to', () => {
  const src = `let svcQ = supabase.from('service_tickets').select('id')`
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains[0].variableName, 'svcQ')
})
