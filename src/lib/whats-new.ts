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
  id: '2026-09-01-credit-review-follow-up',
  headline:
    'New: credit holds chase themselves. An order still waiting on AR gets the release link re-sent every few days, and anything AR blocked now emails managers — with its age and AR’s reason — until the hold is cleared.',
  href: '/help/managers/release-a-credit-hold',
  cta: 'See how',
}
