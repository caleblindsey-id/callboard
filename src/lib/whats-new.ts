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
  id: '2026-08-26-warranty-review-lifecycle',
  headline:
    'Change: warranty is now a flag-and-verify flow. Techs flag a repair on the ticket; the billing type picker is gone. Office verifies from the Warranty Claims queue.',
  href: '/help/managers/file-a-warranty-claim',
  cta: 'See how',
}
