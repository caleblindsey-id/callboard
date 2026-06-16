// Shared free-text matcher for in-memory board search (PM + service tickets).
// Builds a lowercase haystack from the given parts and returns true when EVERY
// whitespace-separated token in the query appears somewhere in it. An empty
// query matches everything. Used to filter the already-loaded, already-sorted
// rows client-side, so it stays a fast substring match (no regex, no fuzzy).
export function matchesSearch(
  parts: Array<string | number | null | undefined>,
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((tok) => hay.includes(tok))
}
