/**
 * Which sidebar entry should render as the active one for a given path.
 *
 * Lifted out of Sidebar.tsx (the `compareValues` pattern) so the rule is unit
 * testable without React. The nav was flat for its whole life — every entry a
 * top-level route, none a prefix of another — so a plain `startsWith` was
 * enough. Billing Chase (`/billing/po-follow-up`) is the first entry nested
 * under another entry (`/billing`), and under `startsWith` BOTH lit up at once
 * on the chase page.
 *
 * The rule: an entry is active when the path is inside it AND no deeper nav
 * entry also claims that path. A path under a parent that no nav entry owns
 * (say a future `/billing/foo`) still lights the parent, which is what you
 * want — the crumb should point somewhere.
 */
export function isRouteActive(route: string, pathname: string, allRoutes: readonly string[]): boolean {
  // Dashboard is the only exact match; every path starts with '/'.
  if (route === '/') return pathname === '/'
  if (!pathname.startsWith(route)) return false
  return !allRoutes.some(
    (r) => r.length > route.length && r.startsWith(route) && pathname.startsWith(r)
  )
}
