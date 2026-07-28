import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractChains, classify, scanRepo, type QueryChain } from './soft-delete-guard'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { SOFT_DELETE_ALLOWLIST } from './soft-delete-allowlist'

const SRC_ROOT = path.join(process.cwd(), 'src')

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
    scopeId: '<module>',
    passedToHelper: null,
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
  const c = chain([['select', ['id']]], { variableName: 'svcQ', scopeId: 'fnA' })
  assert.equal(classify(c, new Set(['fnA::svcQ'])).kind, 'guarded')
})

test('a guard on a DIFFERENT variable in the same function does not count', () => {
  // service-reports.ts had a guarded and an unguarded query in one function
  // (two different variable names). A file-scope check would have missed
  // the real bug; this proves same-scope-different-name still separates them.
  const c = chain([['select', ['id']]], { variableName: 'sentQ', scopeId: 'fnA' })
  assert.equal(classify(c, new Set(['fnA::awaitingQ'])).kind, 'violation')
})

test('the SAME variable name guarded in a DIFFERENT function does not leak across (dashboard-metrics.ts regression)', () => {
  // dashboard-metrics.ts declares `svcQ` in both getOpenWorkCounts and
  // getMtdRevenue. Only one of those two chains carries the guard. The OLD,
  // unscoped implementation built siblingGuards from the bare variable name,
  // so a guarded `svcQ` chain in some OTHER function would add just 'svcQ' to
  // the set, and `siblingGuards.has('svcQ')` would then incorrectly match this
  // chain too. This test must discriminate: it hands classify a set containing
  // ONLY the bare name (what the old code would have built), against a chain
  // scope-qualified as 'fnA'. Bare-name lookup would find 'svcQ' present and
  // wrongly return 'guarded'; scope-qualified lookup correctly rejects it
  // because 'fnA::svcQ' is not in the set.
  const unguardedInFnA = chain([['select', ['id']]], { variableName: 'svcQ', scopeId: 'fnA' })
  const bareNameSiblingGuards = new Set(['svcQ'])
  assert.equal(classify(unguardedInFnA, bareNameSiblingGuards).kind, 'violation')
})

test('extractChains assigns different scopeIds to the same variable name declared in two different functions', () => {
  // Modeled directly on the dashboard-metrics.ts shape: two functions, each
  // declaring `let svcQ = supabase.from('service_tickets')...`, only the
  // second carrying the guard.
  const src = `
    export async function getOpenWorkCounts() {
      let svcQ = supabase
        .from('service_tickets')
        .select('id', { count: 'exact', head: true })
        .in('status', OPEN_SERVICE_STATUSES)
      return svcQ
    }

    export async function getMtdRevenue() {
      let svcQ = supabase
        .from('service_tickets')
        .select('billing_amount')
        .is('deleted_at', null)
        .in('status', ['completed', 'billed'])
      return svcQ
    }
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 2)

  const [unguarded, guarded] = chains
  assert.equal(unguarded.variableName, 'svcQ')
  assert.equal(guarded.variableName, 'svcQ')
  assert.notEqual(unguarded.scopeId, guarded.scopeId)

  // Build the siblingGuards set the way scanRepo does, from the real
  // extracted chains, and confirm the unguarded one is still a violation.
  const siblingGuards = new Set([`${guarded.scopeId}::${guarded.variableName}`])
  assert.equal(classify(unguarded, siblingGuards).kind, 'violation')
})

test('the reassignment form q = q.eq(...).is(deleted_at) registers as guarded (AST pass beats the old immediate-only regex)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-guard-test-'))
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'probe.ts'),
      `
        export async function listOpen(supabase: SupabaseClient) {
          let q = supabase.from('service_tickets').select('id')
          q = q.eq('status', 'open').is('deleted_at', null)
          return q
        }
      `
    )
    const findings = scanRepo(tmpDir)
    assert.equal(findings.length, 0)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('a chain passed to applyServiceTicketFilters(...) is exempt via helper delegation', () => {
  const src = `
    function applyServiceTicketFilters(q, filters) { return q }

    const baseQuery = () =>
      applyServiceTicketFilters(
        supabase.from('service_tickets').select('id', { count: 'exact', head: true }),
        filters
      )
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].passedToHelper, 'applyServiceTicketFilters')

  const verdict = classify(chains[0], NO_SIBLINGS)
  assert.equal(verdict.kind, 'exempt')
})

test('helper delegation only counts the query as the FIRST argument, not any position (F1)', () => {
  // applyServiceTicketFilters(otherQ, ourQuery) puts our chain in the filters
  // position, not the query position. Only arguments[0] may be exempt.
  const src = `
    function applyServiceTicketFilters(q, filters) { return q }

    const baseQuery = () =>
      applyServiceTicketFilters(
        otherQ,
        supabase.from('service_tickets').select('id', { count: 'exact', head: true })
      )
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].passedToHelper, null)
  assert.equal(classify(chains[0], NO_SIBLINGS).kind, 'violation')
})

test('a bare call to a same-named local helper is NOT exempt without a definition or import in this file (F2)', () => {
  // The real applyServiceTicketFilters is module-private to service-tickets.ts
  // and never exported. A file that calls something with the same name but
  // neither declares nor imports it must not get a free exemption.
  const src = `
    const baseQuery = () =>
      applyServiceTicketFilters(
        supabase.from('service_tickets').select('id', { count: 'exact', head: true }),
        filters
      )
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].passedToHelper, null)
  assert.equal(classify(chains[0], NO_SIBLINGS).kind, 'violation')
})

test('an imported applyServiceTicketFilters is honored just like a local declaration (F2)', () => {
  const src = `
    import { applyServiceTicketFilters } from './service-tickets'

    const baseQuery = () =>
      applyServiceTicketFilters(
        supabase.from('service_tickets').select('id', { count: 'exact', head: true }),
        filters
      )
  `
  const chains = extractChains(src, 'probe.ts')
  assert.equal(chains.length, 1)
  assert.equal(chains[0].passedToHelper, 'applyServiceTicketFilters')
  assert.equal(classify(chains[0], NO_SIBLINGS).kind, 'exempt')
})

test('the reassignment form X = applyServiceTicketFilters(X, ...) registers as guarded (getServiceTickets shape)', () => {
  // service-tickets.ts:getServiceTickets reassigns through the helper rather
  // than chaining .is(...) or passing the from(...) expression straight in.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-guard-test-'))
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'probe.ts'),
      `
        function applyServiceTicketFilters(q, filters) { return q }

        export async function getServiceTickets(filters?: ServiceTicketFilters) {
          let query = supabase
            .from('service_tickets')
            .select('id')
            .order('id', { ascending: false })
          query = applyServiceTicketFilters(query, filters)
          return query
        }
      `
    )
    const findings = scanRepo(tmpDir)
    assert.equal(findings.length, 0)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('a variable name reused for two different .from() chains in one function fails closed either direction (F4)', () => {
  // Fail-closed within-one-function collision, distinct from the cross-function
  // case above: a plain re-declaration of the same name to an entirely
  // different, unguarded query must not inherit the first declaration's guard.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-guard-test-'))
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'probe.ts'),
      `
        export async function listSomething(cond: boolean) {
          let q = supabase.from('service_tickets').select('id').is('deleted_at', null)
          if (cond) {
            q = supabase.from('service_tickets').select('id')
          }
          return q
        }
      `
    )
    const findings = scanRepo(tmpDir)
    // The first (directly guarded) chain must not produce a finding; the
    // second (unguarded, same name) must, and must not be masked by the first.
    assert.equal(findings.length, 1)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('guarded and unguarded copies of the same variable name in if/else branches also fail closed (F4)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-guard-test-'))
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'probe.ts'),
      `
        export async function listSomething(cond: boolean) {
          if (cond) {
            let q = supabase.from('service_tickets').select('id').is('deleted_at', null)
            return q
          } else {
            let q = supabase.from('service_tickets').select('id')
            return q
          }
        }
      `
    )
    const findings = scanRepo(tmpDir)
    assert.equal(findings.length, 1)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('an unresolvable table name is a violation only when not otherwise exempt', () => {
  const exempt = chain([['update', ['<expr>']], ['eq', ['id', '<expr>']]], { table: null })
  assert.equal(classify(exempt, NO_SIBLINGS).kind, 'exempt')

  const risky = chain([['select', ['id']], ['eq', ['status', 'open']]], { table: null })
  const v = classify(risky, NO_SIBLINGS)
  assert.equal(v.kind, 'violation')
  assert.match(v.kind === 'violation' ? v.why : '', /table name/i)
})

test('every allowlist entry carries a non-empty reason', () => {
  for (const e of SOFT_DELETE_ALLOWLIST) {
    assert.ok(
      typeof e.reason === 'string' && e.reason.trim().length > 0,
      `${e.file}:${e.line} needs a reason explaining why it is safe`
    )
  }
})

test('no unguarded multi-row ticket reads outside the allowlist', () => {
  const findings = scanRepo(SRC_ROOT)
  const allowed = new Set(SOFT_DELETE_ALLOWLIST.map((e) => `${e.file}:${e.line}`))
  const unexpected = findings.filter((f) => !allowed.has(`${f.file}:${f.line}`))

  const detail = unexpected
    .map((f) => `  ${f.file}:${f.line}  (${f.table ?? 'dynamic table'})  ${f.why}`)
    .join('\n')

  assert.equal(
    unexpected.length,
    0,
    `Unguarded multi-row reads of service_tickets/pm_tickets:\n${detail}\n\n` +
      `Soft-deleted tickets keep their pre-delete status and RLS does not hide them, ` +
      `so these will silently inflate counts and dollar totals.\n` +
      `Fix: add .is('deleted_at', null) to the chain.\n` +
      `If the omission is deliberate, add an entry with a reason to ` +
      `src/lib/soft-delete-allowlist.ts.`
  )
})

test('allowlist entries all still correspond to a real finding', () => {
  const findings = new Set(scanRepo(SRC_ROOT).map((f) => `${f.file}:${f.line}`))
  const stale = SOFT_DELETE_ALLOWLIST.filter((e) => !findings.has(`${e.file}:${e.line}`))
  assert.deepEqual(
    stale.map((e) => `${e.file}:${e.line}`),
    [],
    'These allowlist entries no longer match a finding. The code moved or was fixed. Remove or re-point them.'
  )
})
