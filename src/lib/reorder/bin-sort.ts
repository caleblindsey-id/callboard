// Whse-4 bin-location parsing into a walk-order sort key.
//
// Bin format (confirmed in the design spec): a zone letter + bay number, e.g.
// "E5", "W1", "H2", with dash-suffixed overflow/shelf positions like "E5-D".
// Parse rule: zone letter -> bay number -> dash-suffix. The bay number is
// zero-padded to 3 digits so "E5" sorts before "E10" (plain numeric-string
// comparison would put "E10" before "E5").

const BIN_PATTERN = /^([A-Za-z]+)(\d+)(?:-(.+))?$/

// Sorts after any well-formed key (which starts with an uppercase letter,
// ASCII 65-90) since "~" is ASCII 126 — higher than any letter, digit, or the
// "|" delimiter (124) used below.
const UNPARSEABLE_SORT_LAST = '~~~'

/**
 * Build a walk-order sort key for a Whse-4 bin location string.
 * null / empty / non-matching input (e.g. "SR") sorts last so those items
 * still surface (via search) rather than silently vanishing from the walk.
 */
export function binSortKey(loc: string | null): string {
  if (!loc) return UNPARSEABLE_SORT_LAST

  const match = loc.match(BIN_PATTERN)
  if (!match) return UNPARSEABLE_SORT_LAST

  const [, zone, bay, suffix] = match
  const paddedBay = bay.padStart(3, '0')

  return `${zone.toUpperCase()}|${paddedBay}|${suffix ?? ''}`
}
