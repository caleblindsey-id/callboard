import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractChains, classify, type QueryChain } from './soft-delete-guard'

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

test('the walk survives await and parentheses mid-chain', () => {
  const src = `
    const { count } = (await supabase
      .from('service_tickets')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null))
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.deepEqual(chains[0].methods.map((m) => m.name), ['select', 'is'])
})

test('line numbers are accurate for chains not starting on line 1', () => {
  const src = `const x = 1
const y = 2
const { data } = await supabase.from('service_tickets').select('id')`
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].line, 3)
})

function chain(methods: [string, string[]][], over: Partial<QueryChain> = {}): QueryChain {
  return {
    table: 'service_tickets',
    methods: methods.map(([name, args]) => ({ name, args })),
    line: 1,
    variableName: null,
    ...over,
  }
}

const NO_SIBLINGS = new Set<string>()

test('a chain carrying the guard is guarded', () => {
  const c = chain([['select', ['id']], ['is', ['deleted_at', '<expr>']], ['eq', ['status', 'open']]])
  assert.equal(classify(c, NO_SIBLINGS).kind, 'guarded')
})

test('a bare multi-row read is a violation', () => {
  const c = chain([['select', ['id']], ['eq', ['status', 'open']]])
  assert.equal(classify(c, NO_SIBLINGS).kind, 'violation')
})

test('writes are exempt', () => {
  for (const verb of ['insert', 'update', 'upsert', 'delete']) {
    const c = chain([[verb, ['<expr>']], ['eq', ['status', 'open']]])
    assert.equal(classify(c, NO_SIBLINGS).kind, 'exempt', `${verb} should be exempt`)
  }
})

test('a read by primary key is exempt', () => {
  const c = chain([['select', ['id']], ['eq', ['id', '<expr>']]])
  assert.equal(classify(c, NO_SIBLINGS).kind, 'exempt')
})

test('a single-row read is exempt', () => {
  for (const terminal of ['single', 'maybeSingle']) {
    const c = chain([['select', ['id']], ['eq', ['approval_token', '<expr>']], [terminal, []]])
    assert.equal(classify(c, NO_SIBLINGS).kind, 'exempt', `${terminal} should be exempt`)
  }
})

test('a guard applied to the same variable later in the file counts', () => {
  const c = chain([['select', ['id']]], { variableName: 'svcQ' })
  assert.equal(classify(c, new Set(['svcQ'])).kind, 'guarded')
})

test('a guard on a DIFFERENT variable does not count', () => {
  // service-reports.ts had a guarded and an unguarded query in one function.
  // A file-scope or function-scope check would have missed the real bug.
  const c = chain([['select', ['id']]], { variableName: 'sentQ' })
  assert.equal(classify(c, new Set(['awaitingQ'])).kind, 'violation')
})

test('an unresolvable table name is a violation only when not otherwise exempt', () => {
  const exempt = chain([['update', ['<expr>']], ['eq', ['id', '<expr>']]], { table: null })
  assert.equal(classify(exempt, NO_SIBLINGS).kind, 'exempt')

  const risky = chain([['select', ['id']], ['eq', ['status', 'open']]], { table: null })
  const v = classify(risky, NO_SIBLINGS)
  assert.equal(v.kind, 'violation')
  assert.match(v.kind === 'violation' ? v.why : '', /table name/i)
})
