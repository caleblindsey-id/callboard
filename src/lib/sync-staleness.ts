// ERP sync staleness — shared threshold + helpers for the dashboard banner and
// the coordinator worklist notices. The nightly sync lands around 5 AM, so a
// healthy install is never more than ~24h behind; 26h gives the cron an hour
// of slack before we call the data stale. A "success" status alone is not
// health — a sync that succeeded five days ago and never ran again leaves
// stock levels, customers, ship-tos, and tax rates silently out of date.

export const SYNC_STALE_AFTER_HOURS = 26

export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

export function syncAgeLabel(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.floor(hours / 24)} days ago`
}
