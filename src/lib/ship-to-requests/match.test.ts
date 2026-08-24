import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLikelyShipTos, scoreLocation } from './match'
import type { ShipToLocationRow } from '@/types/database'

// Every fixture below is a REAL row from prod on 2026-08-24. The two positive
// cases are the two pending requests whose location already existed in CallBoard.

const loc = (
  id: number,
  name: string,
  address: string | null,
  city: string | null = null,
  zip: string | null = null
): ShipToLocationRow =>
  ({
    id,
    customer_id: 1,
    synergy_customer_code: '1',
    synergy_shiplist_code: String(id),
    name,
    address,
    city,
    state: 'AL',
    zip,
    contact: null,
    email: null,
    provisional: false,
    provisional_created_by: null,
    provisional_created_at: null,
    synced_at: null,
  }) as ShipToLocationRow

test('finds HALLMARK SUBARU from the address the tech typed', () => {
  // Prod request 3. Name shares nothing with the note; the street number carries it.
  const matches = findLikelyShipTos('1837 GRANTS MILL ROAD BIRMINGHAM ALABAMA 35210', [
    loc(1, 'HALLMARK SUBARU', '1837 GRANTS MILL RD, IRONDALE AL 35210'),
    loc(2, 'HALLMARK FORD', '900 SOME OTHER RD, BIRMINGHAM AL 35201'),
  ])
  assert.ok(matches.length >= 1)
  assert.equal(matches[0].location.name, 'HALLMARK SUBARU')
})

test('finds THOMPSON RENTAL STORE MNTGMRY from "2011 northern blvd., Montgomery"', () => {
  // Prod request 9, against a customer with 53 ship-tos.
  const matches = findLikelyShipTos('2011 northern blvd., Montgomery', [
    loc(1, 'THOMPSON RENTAL STORE MNTGMRY', '2011 Northern Blvd, Montgomery AL 36110'),
    loc(2, 'THOMPSON TRACTOR BIRMINGHAM', '2401 Pinson Hwy, Birmingham AL 35217'),
    loc(3, 'THOMPSON TRACTOR TUSCALOOSA', '4600 Kauloosa Ave, Tuscaloosa AL 35401'),
  ])
  assert.equal(matches[0].location.id, 1)
})

test('returns nothing when the location genuinely does not exist', () => {
  // Prod requests 4-8. HEALTHSOUTH has zero ship-tos, but even against a populated
  // unrelated list there must be no suggestion to link.
  const matches = findLikelyShipTos('3800 Ridgeway Dr., Birmingham, AL 35209', [
    loc(1, 'SOME OTHER SITE', '100 Main St, Birmingham AL 35203'),
  ])
  assert.deepEqual(matches, [])
})

test('an empty location list is safe', () => {
  assert.deepEqual(findLikelyShipTos('anything at all', []), [])
})

test('a shared street-suffix word alone does not clear the threshold', () => {
  // "road"/"drive"/"birmingham" style overlap must not manufacture a match.
  const matches = findLikelyShipTos('123 Industrial Road, Birmingham AL', [
    loc(1, 'UNRELATED', '999 Commerce Road, Birmingham AL'),
  ])
  assert.deepEqual(matches, [])
})

test('a site named in words still matches when the words are distinctive', () => {
  // Prod request 1: the tech named a school rather than giving an address.
  const matches = findLikelyShipTos('CRESTLINE ELEMENTARY SCHOOL', [
    loc(1, 'CRESTLINE ELEMENTARY SCHOOL', '3785 Jackson Blvd'),
    loc(2, 'MOUNTAIN BROOK HIGH SCHOOL', '3650 Bethune Dr'),
  ])
  assert.equal(matches[0].location.id, 1)
})

test('scoreLocation explains itself', () => {
  const m = scoreLocation('1837 GRANTS MILL ROAD', loc(1, 'HALLMARK SUBARU', '1837 GRANTS MILL RD'))
  assert.ok(m.score > 0)
  assert.ok(m.reasons.some((r) => r.includes('1837')))
})

test('results come back strongest first', () => {
  const matches = findLikelyShipTos('1500 Bulldog Blvd Cottondale 35453', [
    loc(1, 'WEAKER', '1500 Somewhere Else Ave'),
    loc(2, 'DAVIS EMERSON MIDDLE', '1500 Bulldog Blvd', 'Cottondale', '35453'),
  ])
  assert.equal(matches[0].location.id, 2)
})

// --- regressions: the two false positives the first scoring pass produced when
// --- it was run against the live backlog on 2026-08-24. Both are real rows.

test('does NOT suggest the elementary school next door to the high school', () => {
  // Prod request 14. Same street, same ZIP, three shared words, 799 vs 801.
  // The first scoring pass ranked this a confident match.
  const matches = findLikelyShipTos(
    '801 Commercial St SE, Hanceville, AL 35077\nHanceville High school',
    [loc(1, 'HANCEVILLE ELEMENTRARY SCHOOL', '799 COMMERCIAL ST, HANCEVILLE AL 35077', 'HANCEVILLE', '35077')]
  )
  assert.deepEqual(matches, [])
})

test('does NOT suggest another site of the same customer in the same town', () => {
  // Prod request 11. Shares the ZIP and the customer's own name, nothing else.
  const matches = findLikelyShipTos('4366 notasulga road tallassee al 36078', [
    loc(1, 'TALLASSEE SUPER FOODS/ GILMER', '462 Gilmer Avenue, Tallassee Al 36078', 'Tallassee', '36078'),
  ])
  assert.deepEqual(matches, [])
})

test('a conflicting street number rejects however much else agrees', () => {
  const m = scoreLocation(
    '801 Commercial St, Hanceville AL 35077',
    loc(1, 'COMMERCIAL ST HANCEVILLE SITE', '799 Commercial St, Hanceville AL 35077', 'Hanceville', '35077')
  )
  assert.equal(m.score, 0)
})

test('a shared ZIP alone is not enough', () => {
  const m = scoreLocation('Somewhere in 35077', loc(1, 'A SITE', null, 'Hanceville', '35077'))
  assert.ok(m.score < 8)
})

test('still finds the real Calhoun match found in the live backlog', () => {
  // Prod request 2, against a customer with 58 ship-tos.
  const matches = findLikelyShipTos(
    'Calhoun college in Huntsville \n102 Wynn dr NE Huntsville Al 35805',
    [
      loc(1, 'CALHOUN COMMUNITY COLLEGE-HUNT', '102 Wynn Dr NW, Huntsville AL 35805', 'Huntsville', '35805'),
      loc(2, 'REDSTONE FEDERAL CREDIT UNION', '220 Wynn Dr, Huntsville AL 35893', 'Huntsville', '35893'),
    ]
  )
  assert.equal(matches.length, 1)
  assert.equal(matches[0].location.id, 1)
})
