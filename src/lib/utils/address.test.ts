import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatZip, normalizeEmbeddedZips, formatOneLineAddress } from './address'

test('formatZip drops an all-zero +4 and hyphenates a real one', () => {
  assert.equal(formatZip('362650000'), '36265')
  assert.equal(formatZip('362651234'), '36265-1234')
  assert.equal(formatZip('36265'), '36265')
  assert.equal(formatZip(null), null)
  assert.equal(formatZip('  '), null)
})

test('normalizeEmbeddedZips fixes a zip inside a street line', () => {
  assert.equal(
    normalizeEmbeddedZips('320 Branscomb Drive SW, JACKSONVILLE AL 362650000'),
    '320 Branscomb Drive SW, JACKSONVILLE AL 36265'
  )
  assert.equal(normalizeEmbeddedZips('123 Main St'), '123 Main St')
})

test('formatOneLineAddress does not repeat city/state/zip already in the street', () => {
  assert.equal(
    formatOneLineAddress('320 Branscomb Drive SW, JACKSONVILLE AL 362650000', 'JACKSONVILLE', 'AL', '362650000'),
    '320 Branscomb Drive SW, JACKSONVILLE AL 36265'
  )
})

test('formatOneLineAddress appends the parts a bare street is missing', () => {
  assert.equal(
    formatOneLineAddress('123 Main St', 'Birmingham', 'AL', '35233'),
    '123 Main St, Birmingham, AL, 35233'
  )
})

test('formatOneLineAddress does not treat a state code inside a word as present', () => {
  assert.equal(
    formatOneLineAddress('1 Alabaster Way', 'Alabaster', 'AL', '35007'),
    '1 Alabaster Way, AL, 35007'
  )
})

test('formatOneLineAddress handles a missing street and empty input', () => {
  assert.equal(formatOneLineAddress(null, 'Birmingham', 'AL', '35233'), 'Birmingham, AL, 35233')
  assert.equal(formatOneLineAddress(null, null, null, null), null)
})
