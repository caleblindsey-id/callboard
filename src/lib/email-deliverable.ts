// Is this address one we can actually deliver mail to?
//
// Not every CallBoard user has a real mailbox. Technicians hired before they
// were given Imperial Dade accounts carry a synthetic `tech<synergy_id>@`
// placeholder minted by the Synergy sync, and a couple of accounts exist only
// as a login under the non-routable `@callboard.local` domain. Shop Team is a
// pseudo-user, not a person at all.
//
// Handing one of those to Mandrill produces a hard bounce (or an exception),
// which for an assignment notice would fail the whole request over a message
// that was never going to arrive. Callers use this to skip the email leg and
// fall through to Web Push and the in-app bell, which key off user.id and work
// for everyone.
const NON_DELIVERABLE = [
  /@callboard\.local$/i,
  /^tech\d+@imperialdade\.com$/i,
]

export function isDeliverableEmail(email: string | null | undefined): email is string {
  if (!email) return false
  const trimmed = email.trim()
  if (!trimmed || !trimmed.includes('@')) return false
  return !NON_DELIVERABLE.some((pattern) => pattern.test(trimmed))
}
