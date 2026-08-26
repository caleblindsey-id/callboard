# Soft-Delete Query Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible to add an unguarded multi-row read of `service_tickets` / `pm_tickets` without a test failing.

**Architecture:** A TypeScript-AST checker walks every `.from('service_tickets')` / `.from('pm_tickets')` call chain in `src/`, classifies each as guarded, mechanically exempt, or a violation, and a `node:test` case fails on any violation not carried in an explicit allowlist with a reason. A pre-push hook runs it.

**Tech Stack:** TypeScript compiler API (`typescript`, already a devDependency), `node:test` + `node:assert/strict` via `tsx`, git `core.hooksPath`. No new packages.

**Spec:** `docs/superpowers/specs/2026-07-27-soft-delete-query-guard-design.md`

## Global Constraints

- **No new dependencies.** Use `typescript`, `tsx`, and `node:test`, all already present.
- **All new files go flat in `src/lib/`.** Nested test directories run on Windows (Node 24 expands `src/**/*.test.ts` itself) but silently do not run on macOS, where npm uses `sh` and `**` degrades to `*` without globstar. A guard that silently does not run is worse than no guard. Verified empirically 2026-07-28.
- **Every allowlist entry requires a non-empty `reason`.** An entry without one fails the test.
- **Never use em-dashes or en-dashes** in any file content, comment, commit message, or output string.
- **Do not commit to a branch other than the feature branch.** Two sessions share this checkout; run `git branch --show-current` before every commit and stop if it is not `feat/soft-delete-query-guard`.
- **Base branch:** rebase onto `origin/master` before starting. The spec branch is behind (master moved to `090a49a` with the parts auto-add work and migration 145).

---

### Task 0: Rebase onto current master

**Files:** none (git only)

**Interfaces:**
- Consumes: nothing
- Produces: a `feat/soft-delete-query-guard` branch whose tip contains both the spec doc and current master

- [ ] **Step 1: Confirm the working tree is clean and you are on the right branch**

```bash
cd "C:/Users/Caleb Lindsey/Desktop/callboard"
git status --porcelain
git branch --show-current
```

Expected: no output from the first command, and `feat/soft-delete-query-guard` from the second. If the tree is dirty, STOP. Another session shares this checkout and the dirty files are probably theirs. Ask before touching anything.

- [ ] **Step 2: Rebase onto master**

```bash
git fetch origin
git rebase origin/master
```

Expected: "Successfully rebased". The only commit on this branch is the spec doc, which touches a file nobody else edits, so a conflict is not expected. If one occurs, STOP and report it.

- [ ] **Step 3: Verify the baseline is green before changing anything**

```bash
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: typecheck silent (success), tests all passing. Record the passing test count. If the baseline is already red, STOP and report. Do not build on a broken baseline.

- [ ] **Step 4: Push the rebased branch**

```bash
git push --force-with-lease
```

`--force-with-lease` is required because the rebase rewrote the branch. This is safe here: the branch has no other contributors and no PR. Do not use plain `--force`.

---

### Task 1: Chain extraction from the AST

Builds the piece that made the original grep approach fail. Given a source file, find every Supabase query chain and return its method names and literal arguments as data.

**Files:**
- Create: `src/lib/soft-delete-guard.ts`
- Create: `src/lib/soft-delete-guard.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type ChainMethod = { name: string; args: string[] }` where `args` holds string-literal argument values only, in order, with non-literal arguments represented as the sentinel `'<expr>'`
  - `export type QueryChain = { table: string | null; methods: ChainMethod[]; line: number; variableName: string | null }` where `table` is `null` for a non-literal table argument and `variableName` is the identifier the chain is assigned to, if any
  - `export function extractChains(sourceText: string, fileName: string): QueryChain[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/soft-delete-guard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: FAIL, cannot find module `./soft-delete-guard`.

- [ ] **Step 3: Implement the extractor**

Create `src/lib/soft-delete-guard.ts`:

```ts
// Dev-only tooling, imported solely by soft-delete-guard.test.ts. It lives in
// src/lib rather than scripts/ so it is covered by tsconfig and matched by the
// npm test glob on both Windows and macOS. No app code imports it, so it never
// reaches the bundle.
import ts from 'typescript'

export type ChainMethod = { name: string; args: string[] }

export type QueryChain = {
  table: string | null
  methods: ChainMethod[]
  line: number
  variableName: string | null
}

// A Supabase chain always terminates in one of these. Array.from(...).map(...)
// and Buffer.from(...) never do, which is how we tell them apart without
// needing type information.
const QUERY_VERBS = new Set(['select', 'insert', 'update', 'upsert', 'delete'])

function literalArg(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return '<expr>'
}

// Walks forward through `.a().b().c()` starting at the `.from()` call, and
// returns both the collected methods and the outermost node of the chain.
function walkChain(fromCall: ts.CallExpression): { methods: ChainMethod[]; outermost: ts.Node } {
  const methods: ChainMethod[] = []
  let node: ts.Node = fromCall

  for (;;) {
    const parent = node.parent
    if (!parent) break

    // Step over `await` and parenthesis so they do not end the walk.
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) {
      node = parent
      continue
    }

    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const call = parent.parent
      if (ts.isCallExpression(call) && call.expression === parent) {
        methods.push({ name: parent.name.text, args: call.arguments.map(literalArg) })
        node = call
        continue
      }
    }
    break
  }

  return { methods, outermost: node }
}

// Finds the identifier a chain lands in, covering both `const q = ...` and the
// `q = q.eq(...)` reassignment form used across src/lib/db.
function assignedVariable(outermost: ts.Node): string | null {
  let node: ts.Node = outermost
  while (node.parent) {
    const parent = node.parent
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(parent.left)
    ) {
      return parent.left.text
    }
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) {
      node = parent
      continue
    }
    break
  }
  return null
}

export function extractChains(sourceText: string, fileName: string): QueryChain[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const chains: QueryChain[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments.length >= 1
    ) {
      const { methods, outermost } = walkChain(node)
      if (methods.some((m) => QUERY_VERBS.has(m.name))) {
        const arg = node.arguments[0]
        const isLiteral = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
        chains.push({
          table: isLiteral ? (arg as ts.StringLiteralLike).text : null,
          methods,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          variableName: assignedVariable(outermost),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return chains
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: all 6 tests PASS. If the `Array.from` test fails, the `QUERY_VERBS` filter is not being applied. If the multi-line template test fails, `ts.ScriptKind.TSX` may be wrong for the probe source; it should still parse plain TS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git branch --show-current   # must print feat/soft-delete-query-guard
git add src/lib/soft-delete-guard.ts src/lib/soft-delete-guard.test.ts
git commit -m "test(guard): AST chain extraction for supabase queries"
```

---

### Task 2: Classify each chain

Turns a `QueryChain` into a verdict. This is where the exemption rules from the spec live.

**Files:**
- Modify: `src/lib/soft-delete-guard.ts`
- Modify: `src/lib/soft-delete-guard.test.ts`

**Interfaces:**
- Consumes: `QueryChain`, `ChainMethod` from Task 1
- Produces:
  - `export type Verdict = { kind: 'guarded' } | { kind: 'exempt'; why: string } | { kind: 'violation'; why: string }`
  - `export function classify(chain: QueryChain, siblingGuards: Set<string>): Verdict` where `siblingGuards` holds variable names that receive `.is('deleted_at', null)` elsewhere in the same file

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/soft-delete-guard.test.ts`. Do NOT add a second import statement: widen the existing Task 1 import in place so the file keeps one import per module.

```ts
// Widen the existing top-of-file import to:
//   import { extractChains, classify, type QueryChain } from './soft-delete-guard'

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: FAIL, `classify` is not exported.

- [ ] **Step 3: Implement `classify`**

Append to `src/lib/soft-delete-guard.ts`:

```ts
export type Verdict =
  | { kind: 'guarded' }
  | { kind: 'exempt'; why: string }
  | { kind: 'violation'; why: string }

const WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])
const SINGLE_TERMINALS = new Set(['single', 'maybeSingle'])

function hasGuard(methods: ChainMethod[]): boolean {
  return methods.some((m) => m.name === 'is' && m.args[0] === 'deleted_at')
}

export function classify(chain: QueryChain, siblingGuards: Set<string>): Verdict {
  const { methods, variableName, table } = chain

  if (hasGuard(methods)) return { kind: 'guarded' }

  // The `let q = supabase.from(...)...; q = q.is('deleted_at', null)` form.
  // Keyed on the variable, never the enclosing function: service-reports.ts
  // holds a guarded and an unguarded query in one function, so a wider scope
  // would have hidden the original bug.
  if (variableName && siblingGuards.has(variableName)) return { kind: 'guarded' }

  if (methods.some((m) => WRITE_VERBS.has(m.name))) {
    return { kind: 'exempt', why: 'write path' }
  }
  if (methods.some((m) => m.name === 'eq' && m.args[0] === 'id')) {
    return { kind: 'exempt', why: 'reads one row by primary key' }
  }
  if (methods.some((m) => SINGLE_TERMINALS.has(m.name))) {
    return { kind: 'exempt', why: 'reads a single row' }
  }

  if (table === null) {
    return {
      kind: 'violation',
      why: 'dynamic table name could not be resolved, and the chain is not otherwise exempt',
    }
  }

  return { kind: 'violation', why: "multi-row read missing .is('deleted_at', null)" }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: all tests PASS (6 from Task 1 plus 8 here).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git branch --show-current   # must print feat/soft-delete-query-guard
git add src/lib/soft-delete-guard.ts src/lib/soft-delete-guard.test.ts
git commit -m "test(guard): classify chains as guarded, exempt, or violation"
```

---

### Task 3: Scan the repo, seed the allowlist, go green

Wires the checker to real files and makes the suite fail on a real violation.

**Files:**
- Create: `src/lib/soft-delete-allowlist.ts`
- Modify: `src/lib/soft-delete-guard.ts`
- Modify: `src/lib/soft-delete-guard.test.ts`

**Interfaces:**
- Consumes: `extractChains`, `classify` from Tasks 1 and 2
- Produces:
  - `export type AllowlistEntry = { file: string; line: number; reason: string }`
  - `export const SOFT_DELETE_ALLOWLIST: AllowlistEntry[]`
  - `export function scanRepo(rootDir: string): Finding[]` where `export type Finding = { file: string; line: number; table: string | null; why: string }`, `file` is a repo-relative POSIX path

- [ ] **Step 1: Write the failing test**

Append to `src/lib/soft-delete-guard.test.ts`:

```ts
// Again, widen the existing import rather than adding another:
//   import { extractChains, classify, scanRepo, type QueryChain } from './soft-delete-guard'
// These two are new modules and do get their own import lines:
import path from 'node:path'
import { SOFT_DELETE_ALLOWLIST } from './soft-delete-allowlist'

const SRC_ROOT = path.join(process.cwd(), 'src')

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: FAIL, cannot find module `./soft-delete-allowlist`.

- [ ] **Step 3: Implement `scanRepo`**

Append to `src/lib/soft-delete-guard.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'

export type Finding = { file: string; line: number; table: string | null; why: string }

const WATCHED_TABLES = new Set(['service_tickets', 'pm_tickets'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(path.join(dir, entry.name), out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

export function scanRepo(rootDir: string): Finding[] {
  const findings: Finding[] = []

  for (const abs of walkFiles(rootDir)) {
    const text = fs.readFileSync(abs, 'utf8')

    // Cheap prefilter. Skipping files that never mention either table keeps the
    // full scan well under a second, which is what makes a pre-push hook viable.
    if (!text.includes('service_tickets') && !text.includes('pm_tickets')) continue

    const rel = path.relative(process.cwd(), abs).split(path.sep).join('/')
    const chains = extractChains(text, abs)

    // Variables that receive the guard anywhere in this file, for the
    // reassignment form. Collected per file, matched per variable.
    const siblingGuards = new Set<string>()
    for (const c of chains) {
      if (c.variableName && hasGuard(c.methods)) siblingGuards.add(c.variableName)
    }
    for (const m of text.matchAll(/(\w+)\s*=\s*\1\s*\.is\(\s*['"]deleted_at['"]/g)) {
      siblingGuards.add(m[1])
    }

    for (const c of chains) {
      // A dynamic table name in a file that mentions neither table is not ours.
      const watched = c.table === null ? true : WATCHED_TABLES.has(c.table)
      if (!watched) continue

      const verdict = classify(c, siblingGuards)
      if (verdict.kind === 'violation') {
        findings.push({ file: rel, line: c.line, table: c.table, why: verdict.why })
      }
    }
  }

  return findings
}
```

- [ ] **Step 4: Create the allowlist with the known judgment exceptions**

Create `src/lib/soft-delete-allowlist.ts`. The line numbers below are from the 2026-07-27 audit and WILL have drifted. Do not trust them: run Step 5 first, then set each `line` to what the scan actually reports.

```ts
// Sites that intentionally read tickets without .is('deleted_at', null).
//
// Soft-deleted tickets keep their pre-delete status and RLS does not filter
// them, so every multi-row read normally needs the guard. These are the
// deliberate exceptions. Each one needs a reason: the test fails without it.
//
// Adding an entry here is a decision, not a formality. If you are unsure
// whether a site belongs here, it does not.
export type AllowlistEntry = { file: string; line: number; reason: string }

export const SOFT_DELETE_ALLOWLIST: AllowlistEntry[] = [
  {
    file: 'src/lib/db/auditEvents.ts',
    line: 105,
    reason:
      'Audit history must outlive deletion. Resolving a work order number to ticket ids has to find deleted tickets so their trail still renders.',
  },
  {
    file: 'src/app/api/billing/service/export/route.ts',
    line: 53,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/app/api/billing/service/mark-billed/route.ts',
    line: 60,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/app/api/billing/service/unexport/route.ts',
    line: 49,
    reason:
      'Acts on an explicit id set posted from the billing board, which is already guarded. The route re-checks status and billing_exported before writing.',
  },
  {
    file: 'src/lib/service-tickets/notify-assignment.ts',
    line: 209,
    reason:
      'Bulk assignment notice reads the exact id set the bulk-assign action just wrote, sourced from the guarded service board.',
  },
]
```

- [ ] **Step 5: Run the scan and correct every line number**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts 2>&1 | head -40
```

Read the failure output. For each reported finding, decide:

- **A real omission** (a dashboard card, queue, or report that should never count deleted tickets): fix the source file by adding `.is('deleted_at', null)` to the chain. Do not allowlist it.
- **A genuine exception**: correct the matching allowlist `line`, or add an entry with a reason of your own.

The five seeded entries are expected to appear. Any finding beyond them in `service_tickets` is a surprise and worth reporting before you fix it, since PR #256 was supposed to have cleared them. Findings in `pm_tickets` are expected and belong to Task 4: leave them failing for now if they are numerous, and note them.

- [ ] **Step 6: Run until green**

```bash
npx tsx --test src/lib/soft-delete-guard.test.ts
```

Expected: all tests PASS. If `pm_tickets` findings are blocking, finish Task 4 before claiming this task complete.

- [ ] **Step 7: Confirm the guard actually catches a regression**

This is the step that proves the guard works. Temporarily break a file:

```bash
node -e "const f='src/lib/db/dashboard-metrics.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f, s.replace(\"    .is('deleted_at', null)\n    .in('status', OPEN_SERVICE_STATUSES)\", \"    .in('status', OPEN_SERVICE_STATUSES)\"))"
npx tsx --test src/lib/soft-delete-guard.test.ts 2>&1 | grep -c "dashboard-metrics"
git checkout src/lib/db/dashboard-metrics.ts
```

Expected: the grep count is 1 or more, meaning the guard flagged the removal. Then the `git checkout` restores the file. Confirm with `git status --porcelain src/lib/db/dashboard-metrics.ts` that it is clean again. If the guard did NOT flag it, the checker is broken and Tasks 1 to 3 need revisiting before going further.

- [ ] **Step 8: Full verification and commit**

```bash
npm run typecheck && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -5
git branch --show-current   # must print feat/soft-delete-query-guard
git add src/lib/soft-delete-guard.ts src/lib/soft-delete-guard.test.ts src/lib/soft-delete-allowlist.ts
git commit -m "feat(guard): fail tests on unguarded multi-row ticket reads"
```

Lint must show the same 9 errors and 16 warnings as the pre-existing baseline. Any new one is yours to fix.

---

### Task 4: PM sweep

Scope is unknown by design. `service_tickets` was audited thoroughly on 2026-07-27; the 74 `pm_tickets` sites were only spot-checked, and 57 PM tickets are soft-deleted while still carrying an open status.

**Files:**
- Modify: whichever files the scan reports (unknown until Step 1)
- Modify: `src/lib/soft-delete-allowlist.ts` if any PM site is a genuine exception

**Interfaces:**
- Consumes: `scanRepo` from Task 3
- Produces: no new interfaces, only corrected queries

- [ ] **Step 1: List the PM findings**

```bash
npx tsx -e "import {scanRepo} from './src/lib/soft-delete-guard.ts'; const f=scanRepo(process.cwd()+'/src').filter(x=>x.table==='pm_tickets'||x.table===null); console.log(f.length+' findings'); for(const x of f) console.log('  '+x.file+':'+x.line+'  '+x.why)"
```

Record the count before changing anything.

- [ ] **Step 2: Triage each finding against the same test used for service tickets**

For each one, open the file and read the surrounding function. Ask: does this count, sum, or list across multiple tickets for a metric, queue, board, or report? If yes it is a real bug. The strongest tell, and the one that found all four extra sites on 2026-07-27, is **asymmetry**: a `pm_tickets` query guarded while its `service_tickets` sibling in the same `Promise.all` is not, or two sibling queries in one function disagreeing.

Do not bulk-add the guard. The 55-flagged-6-real result from the original grep sweep is what that produces.

- [ ] **Step 3: Fix the real ones**

For each real omission, add `.is('deleted_at', null)` to the chain, placed directly after `.select(...)` to match the house ordering in `src/lib/db/dashboard-metrics.ts`.

- [ ] **Step 4: Quantify the impact against prod before claiming the fix works**

For each corrected metric, run the before and after counts. Use the Supabase MCP against project `haohkybnmnpuxpiykjvb`. Template, substituting the real status list and column:

```sql
select
  count(*) filter (where status in (<statuses>)) as before,
  count(*) filter (where status in (<statuses>) and deleted_at is null) as after
from pm_tickets;
```

State both numbers. A parity claim without them is unverified. This mirrors how PR #256 was verified.

- [ ] **Step 5: Run the full suite**

```bash
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: PASS, including the Task 3 guard test.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/soft-delete-query-guard
git add -u
git commit -m "fix(pm): exclude soft-deleted PM tickets from multi-row reads"
```

If Step 1 found zero PM findings, skip Steps 3 to 6 and record that in the final report. Zero is a legitimate and welcome outcome.

---

### Task 5: Pre-push hook and documentation

**Files:**
- Create: `.githooks/pre-push`
- Modify: `package.json`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the `npm test` script
- Produces: a self-installing hook

- [ ] **Step 1: Create the hook**

Create `.githooks/pre-push`:

```sh
#!/bin/sh
# Blocks a push that would introduce an unguarded multi-row read of
# service_tickets / pm_tickets. See docs/superpowers/specs/2026-07-27-soft-delete-query-guard-design.md
echo "pre-push: running soft-delete query guard..."
if ! npx tsx --test src/lib/soft-delete-guard.test.ts; then
  echo ""
  echo "Push blocked: unguarded ticket reads found. Fix them, or add an"
  echo "allowlist entry with a reason in src/lib/soft-delete-allowlist.ts."
  exit 1
fi
exit 0
```

Run only the guard test rather than the whole suite so the hook stays fast enough that nobody reaches for `--no-verify`.

- [ ] **Step 2: Make it executable and self-installing**

```bash
git update-index --chmod=+x .githooks/pre-push
```

Add a `prepare` script to `package.json` so `npm install` wires it up on every clone and machine. The scripts block becomes:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/**/*.test.ts",
    "check:migrations": "node scripts/check-migration-drift.mjs",
    "prepare": "git config core.hooksPath .githooks"
  },
```

- [ ] **Step 3: Install and verify the hook fires**

```bash
npm run prepare
git config core.hooksPath   # expect: .githooks
```

Then prove it blocks a bad push without actually pushing anything:

```bash
node -e "const f='src/lib/db/dashboard-metrics.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f, s.replace(\"    .is('deleted_at', null)\n    .in('status', OPEN_SERVICE_STATUSES)\", \"    .in('status', OPEN_SERVICE_STATUSES)\"))"
git stash push -- src/lib/db/dashboard-metrics.ts
git stash pop
sh .githooks/pre-push; echo "hook exit code: $?"
git checkout src/lib/db/dashboard-metrics.ts
```

Expected: `hook exit code: 1`. Then confirm `git status --porcelain src/lib/db/dashboard-metrics.ts` is empty so the file is restored.

- [ ] **Step 4: Document the rule where the next agent will read it**

Add to `CLAUDE.md`, under the existing conventions, adjusting the heading to match the file's structure:

```markdown
## Soft-deleted tickets

`service_tickets.deleted_at` and `pm_tickets.deleted_at` are soft deletes, and a
deleted ticket keeps its pre-delete status. RLS does NOT filter deleted rows: the
select policies scope by role only. So every multi-row read that counts, sums, or
lists needs `.is('deleted_at', null)` or it silently inflates.

`npm test` enforces this. If a read is deliberately unguarded (a by-id lookup, a
write, audit-trail resolution), add an entry with a reason to
`src/lib/soft-delete-allowlist.ts`.

Prefer `applyServiceTicketFilters()` in `src/lib/db/service-tickets.ts` for board
and count queries. It already handles the default-hide, deletedOnly, and
includeDeleted cases.
```

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -5
```

Expected: typecheck silent, lint at the pre-existing baseline of 9 errors and 16 warnings, all tests passing.

- [ ] **Step 6: Commit and push**

```bash
git branch --show-current   # must print feat/soft-delete-query-guard
git add .githooks/pre-push package.json CLAUDE.md
git commit -m "chore(guard): pre-push hook and contributor docs"
git push
```

The hook will run against itself on this push. That is the real end-to-end test.

- [ ] **Step 7: Open the PR**

```bash
gh pr create --base master --head feat/soft-delete-query-guard \
  --title "feat(guard): prevent unguarded reads of soft-deleted tickets" \
  --body "See docs/superpowers/specs/2026-07-27-soft-delete-query-guard-design.md

Follows PR #256, which fixed 12 unguarded reads after the Open Work card was found reading Svc 161 against a true 64.

- AST checker over every .from('service_tickets'/'pm_tickets') chain
- Mechanical exemptions for writes, by-id reads, single-row reads, and the shared filter helper
- Judgment exceptions in an allowlist that requires a reason
- Pre-push hook, self-installing via npm prepare

PM sweep results: <fill in the Task 4 count and the before/after prod figures>"
```

Replace the placeholder in the body with the real Task 4 outcome before running the command.

---

## Definition of done

1. Adding an unguarded multi-row read anywhere under `src/` fails `npm test` with a message naming file and line. Proven by Task 3 Step 7, not assumed.
2. `scanRepo` reports zero findings on the branch outside the allowlist, and every allowlist entry carries a reason.
3. A fresh clone gets the hook from `npm install` alone.
4. Task 4 findings are fixed, with before and after prod counts stated for each corrected metric.
5. Lint matches the pre-existing baseline of 9 errors and 16 warnings. Typecheck and build are clean.

## Notes for the implementer

- **Two sessions share this checkout.** Run `git branch --show-current` before every commit. On 2026-07-27 a commit landed on someone else's feature branch this way. If `git status` shows files you did not touch, they are not yours: stop and ask.
- **The line-number coupling in the allowlist is deliberate friction.** Moving an allowlisted query makes the stale-entry test fail, which forces a human to re-confirm the exception is still justified. If it becomes genuinely painful, switch the key to an enclosing function name, but do not silently loosen it to file-only: that would let a new unguarded query in an already-allowlisted file pass unnoticed.
- **Do not add `deleted_at` handling to RLS.** It cannot work. The manager Deleted board needs deleted rows, so a policy exception would leave managers with inflated counts while coordinators got correct ones. The reasoning is in the spec.
