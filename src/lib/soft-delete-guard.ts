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
