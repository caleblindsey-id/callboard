import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintToken, hashPasscode, verifyPasscode, parseEmailList } from './credit-review-crypto'

test('mintToken produces a url-safe token', () => {
  const t = mintToken()
  assert.match(t, /^[A-Za-z0-9_-]+$/)
  assert.ok(t.length >= 11)
})

test('mintToken is unlikely to collide', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(mintToken())
  assert.equal(seen.size, 1000)
})

test('hashPasscode + verifyPasscode round-trips', async () => {
  const hash = await hashPasscode('let-me-in-1234')
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/)
  assert.equal(await verifyPasscode('let-me-in-1234', hash), true)
})

test('verifyPasscode rejects the wrong passcode', async () => {
  const hash = await hashPasscode('correct horse')
  assert.equal(await verifyPasscode('wrong horse', hash), false)
})

test('verifyPasscode rejects empty / malformed stored values', async () => {
  assert.equal(await verifyPasscode('x', ''), false)
  assert.equal(await verifyPasscode('x', 'not-a-hash'), false)
  assert.equal(await verifyPasscode('x', 'scrypt$16384$8$1$only-five'), false)
  assert.equal(await verifyPasscode('x', 'bcrypt$16384$8$1$aa$bb'), false)
})

test('hashPasscode salts — same input yields different hashes', async () => {
  const a = await hashPasscode('same')
  const b = await hashPasscode('same')
  assert.notEqual(a, b)
  assert.equal(await verifyPasscode('same', a), true)
  assert.equal(await verifyPasscode('same', b), true)
})

test('parseEmailList splits commas, semicolons, whitespace and drops junk', () => {
  assert.deepEqual(parseEmailList('a@x.com, b@y.com; c@z.com'), ['a@x.com', 'b@y.com', 'c@z.com'])
  assert.deepEqual(parseEmailList(' a@x.com \n b@y.com '), ['a@x.com', 'b@y.com'])
  assert.deepEqual(parseEmailList('a@x.com,notanemail,'), ['a@x.com'])
  assert.deepEqual(parseEmailList(''), [])
  assert.deepEqual(parseEmailList(null), [])
})
