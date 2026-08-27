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
  id: '2026-08-27-billing-chase-synergy-same-day',
  headline:
    'Change: bill completed work faster. Key the Synergy order the day work finishes — export is never blocked by a missing PO. One Billing Chase list covers PM and service; a nightly check pre-fills invoice numbers Synergy already shows as invoiced, for you to confirm.',
  href: '/help/managers/billing-chase',
  cta: 'See how',
}
