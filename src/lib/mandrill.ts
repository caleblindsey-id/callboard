// Thin wrapper around Mandrill (Mailchimp Transactional) messages/send.json.
// One exported function — sendMandrillEmail — used by every transactional send
// out of CallBoard. Reads creds from env so the codebase never needs to know
// the verified-from domain.

const MANDRILL_ENDPOINT = 'https://mandrillapp.com/api/1.0/messages/send.json'

export type MandrillRecipient = {
  email: string
  name?: string
}

export type SendMandrillEmailInput = {
  to: MandrillRecipient
  cc?: MandrillRecipient[]
  subject: string
  html: string
  text: string
  tags?: string[]
  metadata?: Record<string, string>
}

export type SendMandrillEmailResult = {
  messageId: string
  status: 'sent' | 'queued' | 'scheduled'
}

export class MandrillError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'MandrillError'
  }
}

type MandrillSendResponseItem = {
  email: string
  status: 'sent' | 'queued' | 'scheduled' | 'rejected' | 'invalid'
  _id: string
  reject_reason: string | null
}

export async function sendMandrillEmail(
  input: SendMandrillEmailInput
): Promise<SendMandrillEmailResult> {
  const apiKey = process.env.MANDRILL_API_KEY
  const fromEmail = process.env.MANDRILL_FROM_EMAIL
  const fromName = process.env.MANDRILL_FROM_NAME ?? 'CallBoard'

  if (!apiKey) throw new MandrillError('MANDRILL_API_KEY is not configured')
  if (!fromEmail) throw new MandrillError('MANDRILL_FROM_EMAIL is not configured')

  const recipients = [
    { email: input.to.email, name: input.to.name, type: 'to' as const },
    ...(input.cc ?? []).map((r) => ({ email: r.email, name: r.name, type: 'cc' as const })),
  ]

  const body = {
    key: apiKey,
    message: {
      html: input.html,
      text: input.text,
      subject: input.subject,
      from_email: fromEmail,
      from_name: fromName,
      to: recipients,
      preserve_recipients: true,
      track_opens: true,
      // Never rewrite links. Every CallBoard send is transactional with an
      // action link (credit-review Release/Block, estimate approval). Click
      // tracking wraps the href in a mandrillapp.com/track/click redirect that
      // breaks when that host is DNS-blocked (e.g. the Imperial Dade network)
      // and invites link scanners to pre-click/burn single-use tokens.
      track_clicks: false,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
    },
  }

  let res: Response
  try {
    res = await fetch(MANDRILL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new MandrillError('Network error contacting Mandrill', err)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new MandrillError(`Mandrill responded ${res.status}: ${text}`)
  }

  const result = (await res.json()) as MandrillSendResponseItem[]
  const item = result[0]

  if (!item) throw new MandrillError('Mandrill returned an empty response')

  if (item.status === 'rejected' || item.status === 'invalid') {
    throw new MandrillError(
      `Mandrill ${item.status}${item.reject_reason ? `: ${item.reject_reason}` : ''}`
    )
  }

  return { messageId: item._id, status: item.status }
}
