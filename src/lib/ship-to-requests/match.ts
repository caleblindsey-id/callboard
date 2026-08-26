import type { ShipToLocationRow } from '@/types/database'

// Not every ship-to request needs a new address. Two of the fourteen pending on
// 2026-08-24 already existed in CallBoard, and the tech simply could not find them
// because Synergy names a location after the business, not the street:
//
//   tech typed "1837 GRANTS MILL ROAD BIRMINGHAM ALABAMA 35210"
//   already synced as "HALLMARK SUBARU" at 1837 GRANTS MILL RD, IRONDALE AL 35210
//
//   tech typed "2011 northern blvd., Montgomery"
//   already synced as "THOMPSON RENTAL STORE MNTGMRY" at 2011 Northern Blvd
//
// Searching by name finds neither. So we score the customer's existing locations
// against what the tech actually typed, and put the likely ones in front of the
// office as a one-click close. This is a SUGGESTION, never an automatic match: a
// human confirms every link, and the reasons are shown so the call is auditable.
//
// The scoring was tightened after a first pass against the live backlog produced
// two confident false positives, both of which a human could easily have accepted:
//
//   "801 Commercial St SE, Hanceville / Hanceville High school"
//     -> suggested HANCEVILLE ELEMENTRARY SCHOOL at 799 COMMERCIAL ST
//        Same street, same ZIP, three shared words, DIFFERENT building.
//
//   "4366 notasulga road tallassee al 36078"
//     -> suggested TALLASSEE SUPER FOODS/ GILMER at 462 Gilmer Avenue
//        Shared ZIP and the customer's own name. Different address entirely.
//
// Both shared a ZIP, and a ZIP only narrows things to a town. The street number is
// what identifies a building, so it now dominates, a shared ZIP counts for very
// little, and a CONFLICTING street number rejects the candidate outright.

/** Words that carry no signal, so they neither help nor hurt a score. */
const STOP_WORDS = new Set([
  'al', 'ala', 'alabama', 'united', 'states', 'usa', 'us',
  'st', 'street', 'rd', 'road', 'dr', 'drive', 'ave', 'avenue', 'blvd',
  'boulevard', 'ln', 'lane', 'ct', 'court', 'hwy', 'highway', 'pkwy', 'parkway',
  'ste', 'suite', 'apt', 'unit', 'bldg', 'building', 'n', 's', 'e', 'w',
  'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west', 'the', 'and',
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0)
}

/**
 * A 5-digit number is treated as a ZIP, anything else numeric as a street number.
 *
 * Crude but right for this data: every street number in the live backlog is 3 or 4
 * digits and every ZIP is 5. A genuine 5-digit street number would be read as a ZIP
 * and score low, which costs a suggestion rather than producing a wrong one.
 */
function isZip(token: string): boolean {
  return /^\d{5}$/.test(token)
}

function streetNumbers(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => /^\d{1,6}$/.test(t) && !isZip(t)))
}

function zipCodes(tokens: string[]): Set<string> {
  return new Set(tokens.filter(isZip))
}

function wordTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => !/^\d+$/.test(t) && !STOP_WORDS.has(t) && t.length > 2))
}

const STREET_NUMBER_POINTS = 10
const ZIP_POINTS = 2
const WORD_POINTS = 3

export type ShipToMatch = {
  location: ShipToLocationRow
  score: number
  /** Why it matched, shown to the office so the suggestion is auditable. */
  reasons: string[]
}

/**
 * Score one location against a request note. 0 means "do not suggest".
 *
 * A matching street number is the strongest evidence available. A conflicting one
 * is the strongest evidence AGAINST, so it hard-rejects: when the tech gave a
 * street number and the location has a different one, they are different buildings
 * no matter how much of the rest lines up.
 */
export function scoreLocation(note: string, location: ShipToLocationRow): ShipToMatch {
  const noteTokens = tokenize(note)
  const locTokens = tokenize(
    [location.name, location.address, location.city, location.state, location.zip]
      .filter(Boolean)
      .join(' ')
  )

  const noteStreets = streetNumbers(noteTokens)
  const locStreets = streetNumbers(locTokens)
  const sharedStreets = [...noteStreets].filter((n) => locStreets.has(n))

  // Both sides name a street number and none of them agree: different building.
  if (sharedStreets.length === 0 && noteStreets.size > 0 && locStreets.size > 0) {
    return { location, score: 0, reasons: [] }
  }

  const reasons: string[] = []
  let score = 0

  if (sharedStreets.length > 0) {
    score += STREET_NUMBER_POINTS * sharedStreets.length
    reasons.push(`street number ${sharedStreets.join(', ')}`)
  }

  const sharedZips = [...zipCodes(noteTokens)].filter((z) => zipCodes(locTokens).has(z))
  if (sharedZips.length > 0) {
    score += ZIP_POINTS * sharedZips.length
    reasons.push(`ZIP ${sharedZips.join(', ')}`)
  }

  const noteWords = wordTokens(noteTokens)
  const locWords = wordTokens(locTokens)
  const sharedWords = [...noteWords].filter((w) => locWords.has(w))
  if (sharedWords.length > 0) {
    score += WORD_POINTS * sharedWords.length
    reasons.push(sharedWords.slice(0, 4).join(', '))
  }

  return { location, score, reasons }
}

/**
 * Below this, a suggestion is noise. A shared street number plus anything clears
 * it, and so does a distinctly named site (three meaningful words). A shared ZIP
 * and one word does not.
 */
export const MATCH_THRESHOLD = 8

/**
 * Best existing locations for a request note, strongest first.
 *
 * Returns [] rather than a weak guess when nothing clears the threshold, so the
 * office is never nudged toward closing a request against the wrong address.
 */
export function findLikelyShipTos(
  note: string,
  locations: ShipToLocationRow[],
  limit = 3
): ShipToMatch[] {
  return locations
    .map((l) => scoreLocation(note, l))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
