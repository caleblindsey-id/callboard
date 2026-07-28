// Dev-only tooling, imported solely by soft-delete-guard.test.ts. It lives in
// src/lib rather than scripts/ so it is covered by tsconfig and matched by the
// npm test glob on both Windows and macOS. No app code imports it, so it never
// reaches the bundle.
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

export type ChainMethod = { name: string; args: string[] }

export type QueryChain = {
  table: string | null
  methods: ChainMethod[]
  line: number
  variableName: string | null
  // Identity of the nearest enclosing function-like node (its source start
  // position, stringified), or '<module>' when the chain sits at module scope.
  // siblingGuards is keyed on `${scopeId}::${variableName}` so that the same
  // variable name reused in two different functions (dashboard-metrics.ts
  // declares `svcQ` in both getOpenWorkCounts and getMtdRevenue) cannot leak a
  // guard from one function into an unguarded chain in the other.
  scopeId: string
  // Name of the helper this chain's outermost expression is passed into as its
  // first (query) argument (e.g. 'applyServiceTicketFilters'), or null. That
  // helper owns the soft-delete decision for a query object the checker
  // cannot see chained inline.
  passedToHelper: string | null
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

// Position of the nearest enclosing function-like node, stringified, or
// '<module>' when the chain is not inside any function. Position beats name:
// it stays unique for anonymous arrows and for two functions that happen to
// share a name, and (the case that matters here) it tells apart two DIFFERENT
// functions that happen to reuse the same local variable name.
function scopeIdFor(node: ts.Node): string {
  let n: ts.Node | undefined = node
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n)
    ) {
      return String(n.getStart())
    }
    n = n.parent
  }
  return '<module>'
}

// The one shared filter helper that owns the soft-delete decision for a query
// it is handed: default hides deleted rows, deletedOnly flips to deleted-only,
// includeDeleted skips the predicate entirely (src/lib/db/service-tickets.ts:45-69,
// all three are explicit caller opt-ins the helper itself decides between). A
// chain passed straight into it as the query argument is exempt, even though
// the checker never sees .is(...) chained onto this expression.
const DELEGATION_HELPER = 'applyServiceTicketFilters'

// Bare-identifier matching on DELEGATION_HELPER would blind-exempt any file
// that happens to declare or import a same-named local function, since the
// real helper is module-private to service-tickets.ts and not exported. This
// is a proportionate guard, not a module resolver: it only asks whether THIS
// file's own source defines or imports something named applyServiceTicketFilters.
function definesOrImportsHelper(sourceText: string): boolean {
  const declares = new RegExp(`\\bfunction\\s+${DELEGATION_HELPER}\\s*[(<]`).test(sourceText)
  const imports = new RegExp(`import[\\s\\S]*?\\{[\\s\\S]*?\\b${DELEGATION_HELPER}\\b[\\s\\S]*?\\}[\\s\\S]*?from`).test(
    sourceText
  )
  return declares || imports
}

function helperDelegation(outermost: ts.Node, helperAvailable: boolean): string | null {
  if (!helperAvailable) return null
  const parent = outermost.parent
  if (
    parent &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === DELEGATION_HELPER &&
    // Only the first (query) argument counts. applyServiceTicketFilters(otherQ, ourQuery)
    // would put `outermost` in the filters position, not the query position.
    parent.arguments[0] === outermost
  ) {
    return DELEGATION_HELPER
  }
  return null
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
  const helperAvailable = definesOrImportsHelper(sourceText)

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
          scopeId: scopeIdFor(node),
          passedToHelper: helperDelegation(outermost, helperAvailable),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return chains
}

export type Verdict =
  | { kind: 'guarded' }
  | { kind: 'exempt'; why: string }
  | { kind: 'violation'; why: string }

const WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])
const SINGLE_TERMINALS = new Set(['single', 'maybeSingle'])

function hasGuard(methods: ChainMethod[]): boolean {
  return methods.some((m) => m.name === 'is' && m.args[0] === 'deleted_at')
}

// AST replacement for the old regex reassignment pass. The regex
// `/(\w+)\s*=\s*\1\s*\.is\(.../` had two bugs: it could not know which
// function the reassignment lived in (so it fed the whole-file bare-name
// collision this fix closes), and it only matched `.is(` immediately after
// the identifier, missing the chained form `q = q.eq('a', b).is('deleted_at', null)`.
// This walks every `X = ...` assignment and records a scope-qualified key when
// either of two guard-equivalent shapes appears:
//   Form 1: X = X.<chain>, with `.is('deleted_at', ...)` anywhere in the chain.
//   Form 2: X = applyServiceTicketFilters(X, ...), which reassigns through the
//   shared helper (service-tickets.ts:45-69, getServiceTickets:117) instead of
//   chaining .is(...) directly. Same guarantee, different shape.
function reassignmentGuardKeys(sourceText: string, fileName: string): Set<string> {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const keys = new Set<string>()
  const helperAvailable = definesOrImportsHelper(sourceText)

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const name = node.left.text

      let cur: ts.Expression = node.right
      let carriesGuard = false
      while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
        const pae = cur.expression
        if (pae.name.text === 'is' && cur.arguments.length > 0 && literalArg(cur.arguments[0]) === 'deleted_at') {
          carriesGuard = true
        }
        cur = pae.expression
      }
      const isChainForm = carriesGuard && ts.isIdentifier(cur) && cur.text === name

      const isHelperReassignForm =
        helperAvailable &&
        ts.isCallExpression(node.right) &&
        ts.isIdentifier(node.right.expression) &&
        node.right.expression.text === DELEGATION_HELPER &&
        node.right.arguments.length > 0 &&
        ts.isIdentifier(node.right.arguments[0]) &&
        node.right.arguments[0].text === name

      if (isChainForm || isHelperReassignForm) {
        keys.add(`${scopeIdFor(node)}::${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return keys
}

export function classify(chain: QueryChain, siblingGuards: Set<string>): Verdict {
  const { methods, variableName, scopeId, table, passedToHelper } = chain

  if (hasGuard(methods)) return { kind: 'guarded' }

  // The `let q = supabase.from(...)...; q = q.is('deleted_at', null)` form.
  // Keyed on `${scopeId}::${variableName}`, never the variable name alone:
  // service-reports.ts holds a guarded and an unguarded query in one function
  // (two DIFFERENT variables, still needs to tell them apart), and
  // dashboard-metrics.ts reuses the SAME variable name (`svcQ`/`pmQ`) across
  // two DIFFERENT functions (still needs to keep them apart too). Scope alone
  // handles the first case; variable name alone handles neither, which is why
  // both a bare-name key and a whole-file key are wrong.
  if (variableName && siblingGuards.has(`${scopeId}::${variableName}`)) return { kind: 'guarded' }

  if (passedToHelper) {
    return {
      kind: 'exempt',
      why: `delegates soft-delete handling to ${passedToHelper}(...), which owns the soft-delete decision for this query (default hide, deletedOnly, or includeDeleted, per its caller's filters)`,
    }
  }

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

export type Finding = { file: string; line: number; table: string | null; why: string }

const WATCHED_TABLES = new Set(['service_tickets', 'pm_tickets'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(path.join(dir, entry.name), out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
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

    // Scope qualification (QueryChain.scopeId) closes the cross-FUNCTION
    // version of this leak, but not the within-one-function version: reusing
    // one variable name for two different .from() chains in the same scope
    // (a plain re-declaration, or guarded/unguarded copies in if/else branches)
    // still shares one scope::variable key. We do not attempt flow or block
    // analysis to tell those apart. Fail closed instead: if a scope has more
    // than one .from() chain landing on the same variable name, that slot is
    // ambiguous, so it never participates in sibling-guard matching at all,
    // in either direction. Worst case this flags a safe query as a finding,
    // which is the direction it is safe to be wrong in.
    const slotOccurrences = new Map<string, number>()
    for (const c of chains) {
      if (!c.variableName) continue
      const key = `${c.scopeId}::${c.variableName}`
      slotOccurrences.set(key, (slotOccurrences.get(key) ?? 0) + 1)
    }
    const isAmbiguousSlot = (key: string) => (slotOccurrences.get(key) ?? 0) > 1

    // Variables that receive the guard anywhere in this file, for the
    // reassignment form. Collected per file, keyed per scope+variable so the
    // same variable name reused in a different function never leaks a guard
    // across the boundary (see QueryChain.scopeId).
    const siblingGuards = new Set<string>()
    for (const c of chains) {
      if (!c.variableName) continue
      const key = `${c.scopeId}::${c.variableName}`
      if (isAmbiguousSlot(key)) continue
      if (hasGuard(c.methods)) siblingGuards.add(key)
    }
    for (const key of reassignmentGuardKeys(text, abs)) {
      if (isAmbiguousSlot(key)) continue
      siblingGuards.add(key)
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
