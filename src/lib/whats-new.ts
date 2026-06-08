// The single "what's new" announcement surfaced as a dismissable banner across
// the app (see WhatsNewBanner). Bump `id` whenever there's a new thing worth
// announcing — changing the id makes the banner reappear for everyone, even if
// they dismissed the previous one. Set the export to `null` to hide it entirely.
export interface WhatsNewUpdate {
  id: string
  headline: string
  href: string
  cta: string
}

export const LATEST_UPDATE: WhatsNewUpdate | null = {
  id: '2026-06-08-pm-billing-gate',
  headline: 'Change: exporting a PM no longer marks it billed — enter its Synergy invoice number, then tap Mark Billed.',
  href: '/help/managers/billing',
  cta: 'See how',
}
