import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `service_tickets.parts_received` must only ever be written from
 * partsAllFulfilled() in src/lib/parts.ts.
 *
 * This is a source scan rather than a behavioural test because the thing that
 * broke (feedback #79) is not reachable from a unit test: two Next.js route
 * handlers each derived the column inline, and the copies disagreed about
 * whether 'from_stock' counts as fulfilled. api/service-tickets/[id] said no,
 * api/parts-queue/update said yes, so triaging a part to pull-from-stock set the
 * flag from one route and cleared it from the other — and 22 production rows
 * ended up wrong. Nothing failed; the two routes were simply never compared.
 *
 * Testing the routes end-to-end would need the whole Supabase stack. Asserting
 * on the source is what actually pins the invariant: there is one derivation,
 * and every writer calls it.
 */

const APP_ROOT = path.join(process.cwd(), 'src', 'app')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Strip comments so prose about parts_received never trips the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Assignments to parts_received, as `<lhs>.parts_received = rhs` or an object
 * literal `parts_received: rhs`. A quote immediately before the name means it's
 * a string — a column list or an allowed-fields array — not a write.
 */
function findWrites(src: string): string[] {
  const out: string[] = []
  const re = /(^|[^\w'"`])parts_received\s*(?:=|:)\s*([^\n;,}]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.push(m[2].trim())
  return out
}

// A bare TS type annotation (`parts_received: boolean`) declares the column, it
// doesn't derive it.
const TYPE_ANNOTATION = /^(boolean|string|number)(\s*\|\s*(null|undefined))*$/

test('every parts_received write in src/app goes through partsAllFulfilled', () => {
  const offenders: Array<{ file: string; rhs: string }> = []

  for (const file of walk(APP_ROOT)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    for (const rhs of findWrites(src)) {
      if (rhs === '' || TYPE_ANNOTATION.test(rhs)) continue
      if (rhs.startsWith('partsAllFulfilled(')) continue
      offenders.push({ file: path.relative(process.cwd(), file), rhs })
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `parts_received must be derived by partsAllFulfilled() from src/lib/parts.ts, ` +
      `not re-derived inline — that split is what feedback #79 fixed:\n` +
      offenders.map((o) => `  ${o.file}: parts_received = ${o.rhs}`).join('\n'),
  )
})

test('the scan actually catches the derivation that drifted', () => {
  // Guards the guard: the exact shape api/service-tickets/[id] used to carry.
  const src = `
    const live = parts.filter((p) => !p.cancelled)
    const allReceived = live.length > 0 && live.every((p) => p.status === 'received')
    filtered.parts_received = allReceived
  `
  assert.deepEqual(findWrites(stripComments(src)), ['allReceived'])
})

test('the scan ignores column lists, comments, and type declarations', () => {
  const src = `
    // parts_received is derived, never sent by the client
    /* parts_received = something in prose */
    const ALLOWED = ['status', 'parts_received', 'notes']
    .select('id, parts_received, status')
    type Row = { parts_received: boolean }
  `
  const writes = findWrites(stripComments(src)).filter(
    (rhs) => rhs !== '' && !TYPE_ANNOTATION.test(rhs),
  )
  assert.deepEqual(writes, [])
})
