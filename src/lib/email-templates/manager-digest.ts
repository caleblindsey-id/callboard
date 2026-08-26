import type { DigestRow, SectionResult } from '@/lib/digest/types'
import { SECTIONS, OWNER_BLOCKS, TOP_N, type DigestSection } from '@/lib/digest/sections'
import { dedupedCount } from '@/lib/digest/dedupe'
import { buildSubject } from '@/lib/digest/subject'

// Morning digest email. Pure function: no DB, no fetch, no side effects. The
// caller runs the sections and passes the results in.
//
// Structure and palette mirror estimate-approval.ts, which is CallBoard's
// house style. Two deliberate divergences from it, both because this email
// goes to Ken and his client is mixed classic Outlook while the customer-facing
// templates mostly land in modern clients:
//
//   1. The font stack leads with 'Segoe UI', not -apple-system. A stack
//      leading with -apple-system/BlinkMacSystemFont makes the Word engine
//      fall back to Times across the entire email.
//   2. No VML. The footer button is a one-cell bgcolor table, which renders
//      everywhere without needing xmlns:v on <html>.
//
// The rest of the classic-Outlook hardening, learned the hard way in commit
// e1d8184, every rule from a real broken send:
//   - font-family on EVERY text-bearing cell; Word does not inherit it across
//     nested table cells.
//   - Chips as one-cell bgcolor tables; Word drops display:inline-block,
//     padding and border-radius on a <span>.
//   - Explicit spacer rows between cards; Word drops margin on tables and divs.
//   - bgcolor="..." alongside every CSS background, or fills do not paint.

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const INK = '#1f2937'
const MUTED = '#52525b'
const LINE = '#e4e4e7'
const NAVY = '#0f172a'
const GROUND = '#f4f4f5'

export type ManagerDigestInput = {
  results: SectionResult[]
  appUrl: string
  dateLabel: string
  companyName: string
  isTest?: boolean
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderManagerDigestEmail(input: ManagerDigestInput): EmailTemplate {
  const { results, appUrl, dateLabel, companyName, isTest } = input
  const base = appUrl.replace(/\/$/, '')

  const distinctCount = dedupedCount(results)
  const failedCount = results.filter((r) => !r.ok).length
  const subject =
    (isTest ? '[TEST] ' : '') + buildSubject({ distinctCount, failedCount, dateLabel })

  // Pair each result with its registered section. Results whose key is not in
  // the registry are dropped rather than thrown on, so a stale key from an
  // in-flight deploy degrades to a missing section instead of no email.
  const byKey = new Map<string, DigestSection>(SECTIONS.map((s) => [s.key, s]))
  const paired = results
    .map((r) => ({ result: r, section: byKey.get(r.sectionKey) }))
    .filter((p): p is { result: SectionResult; section: DigestSection } => !!p.section)
    // Empty and healthy sections are omitted. Failed ones always render, or a
    // broken query would look exactly like a cleared queue.
    .filter((p) => !p.result.ok || p.result.rows.length > 0)

  const blocks = OWNER_BLOCKS.map((block) => ({
    block,
    entries: paired.filter((p) => p.section.owner === block.owner),
  })).filter((b) => b.entries.length > 0)

  // --- plain text alternative ---

  const textLines: string[] = [
    subject,
    '',
    `${distinctCount} distinct ${distinctCount === 1 ? 'item' : 'items'} need action.`,
  ]
  if (failedCount > 0) {
    textLines.push(
      `${failedCount} ${failedCount === 1 ? 'section' : 'sections'} could not load and are marked below.`
    )
  }
  for (const { block, entries } of blocks) {
    textLines.push('', `${block.heading}: ${block.role}`.toUpperCase(), '')
    for (const { section, result } of entries) {
      if (!result.ok) {
        textLines.push(`${section.title}: could not load (${result.message})`)
        continue
      }
      textLines.push(`${section.title} (${result.rows.length}). ACTION: ${section.action}`)
      for (const row of result.rows.slice(0, TOP_N)) {
        textLines.push(`  ${row.title}, ${row.subtitle}, ${row.meta}`)
      }
      if (result.rows.length > TOP_N) {
        textLines.push(`  and ${result.rows.length - TOP_N} more`)
      }
      textLines.push(`  View all: ${base}${section.viewAllPath}`)
      textLines.push('')
    }
  }
  textLines.push('', `Open CallBoard: ${base}`, '', `${companyName}`)
  const text = textLines.join('\n')

  // --- html ---

  const headerNote =
    failedCount > 0
      ? `${distinctCount} need action, ${failedCount} ${failedCount === 1 ? 'section' : 'sections'} could not load`
      : `${distinctCount} ${distinctCount === 1 ? 'item needs' : 'items need'} action`

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${GROUND};font-family:${FONT};" bgcolor="${GROUND}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};padding:32px 16px;font-family:${FONT};">
    <tr>
      <td align="center" style="font-family:${FONT};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid ${LINE};">
          <tr>
            <td bgcolor="${NAVY}" style="padding:24px 32px;background:${NAVY};color:#ffffff;font-family:${FONT};">
              <div style="font-size:18px;font-weight:600;font-family:${FONT};">${escapeHtml(companyName)} Morning Digest</div>
              <div style="font-size:13px;color:#cbd5e1;padding-top:4px;font-family:${FONT};">${escapeHtml(dateLabel)} &middot; ${escapeHtml(headerNote)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;font-family:${FONT};color:${INK};">
              ${blocks.map((b) => renderBlock(b.block, b.entries, base)).join(spacer(20))}
              ${spacer(24)}
              ${renderButton(`${base}/`, 'Open CallBoard')}
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:20px 32px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;font-family:${FONT};background:#ffffff;">
              Sent weekday mornings by ${escapeHtml(companyName)}. Recipients are managed in Settings.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// --- pieces ---

function renderBlock(
  block: (typeof OWNER_BLOCKS)[number],
  entries: { result: SectionResult; section: DigestSection }[],
  base: string
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};">
  <tr>
    <td bgcolor="${block.tint}" style="background:${block.tint};padding:8px 12px;border-radius:6px;font-family:${FONT};">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.6px;color:${block.fg};font-family:${FONT};">${escapeHtml(block.heading)}</span>
      <span style="font-size:12px;color:${MUTED};font-family:${FONT};"> &middot; ${escapeHtml(block.role)}</span>
    </td>
  </tr>
  <tr><td style="font-family:${FONT};">${entries
    .map((e) => renderSection(e.section, e.result, base, block))
    .join(spacer(12))}</td></tr>
</table>`
}

function renderSection(
  section: DigestSection,
  result: SectionResult,
  base: string,
  block: (typeof OWNER_BLOCKS)[number]
): string {
  const viewAll = `${base}${section.viewAllPath}`

  if (!result.ok) {
    return `${spacer(12)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fffbeb" style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-family:${FONT};">
  <tr><td style="padding:12px 14px;font-family:${FONT};">
    <div style="font-size:14px;font-weight:600;color:${INK};font-family:${FONT};">${escapeHtml(section.title)}</div>
    <div style="font-size:13px;color:#92400e;padding-top:4px;font-family:${FONT};">This section could not load, so its queue is not shown. (${escapeHtml(result.message)})</div>
  </td></tr>
</table>`
  }

  const shown = result.rows.slice(0, TOP_N)
  const remaining = result.rows.length - shown.length

  return `${spacer(12)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-radius:6px;font-family:${FONT};">
  <tr>
    <td style="padding:12px 14px 8px;font-family:${FONT};">
      <div style="font-size:15px;font-weight:600;color:${INK};font-family:${FONT};">${escapeHtml(section.title)} <span style="color:${MUTED};font-weight:400;">${result.rows.length}</span></div>
      <div style="font-size:12px;color:${MUTED};padding-top:2px;font-family:${FONT};">ACTION: ${escapeHtml(section.action)}</div>
    </td>
  </tr>
  ${shown.map((row) => renderRow(row, base, block)).join('')}
  ${
    remaining > 0
      ? `<tr><td style="padding:6px 14px 10px;font-size:12px;color:${MUTED};font-family:${FONT};">and ${remaining} more</td></tr>`
      : ''
  }
  <tr>
    <td style="padding:0 14px 12px;font-family:${FONT};">
      <a href="${escapeAttr(viewAll)}" style="font-size:12px;color:${block.fg};text-decoration:underline;font-family:${FONT};">View all</a>
    </td>
  </tr>
</table>`
}

function renderRow(row: DigestRow, base: string, block: (typeof OWNER_BLOCKS)[number]): string {
  const href = `${base}${row.deepLink}`
  return `<tr>
  <td style="padding:6px 14px;border-top:1px solid #f4f4f5;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};">
      <tr>
        <td style="font-family:${FONT};">
          <a href="${escapeAttr(href)}" style="font-size:14px;font-weight:600;color:${NAVY};text-decoration:none;font-family:${FONT};">${escapeHtml(row.title)}</a>
          <div style="font-size:13px;color:${INK};font-family:${FONT};">${escapeHtml(row.subtitle)}</div>
          <div style="font-size:12px;color:${MUTED};font-family:${FONT};">${escapeHtml(row.meta)}</div>
        </td>
        <td align="right" valign="top" style="font-family:${FONT};">${chip(row.badge, block)}</td>
      </tr>
    </table>
  </td>
</tr>`
}

/**
 * Chips are one-cell bgcolor tables, never styled spans. The Word engine drops
 * display:inline-block, padding and border-radius on a span, which collapsed
 * every chip to bare text the first time this shipped.
 */
function chip(badge: DigestRow['badge'], block: (typeof OWNER_BLOCKS)[number]): string {
  const bg = badge.bg || block.tint
  const fg = badge.fg || block.fg
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};">
  <tr><td bgcolor="${bg}" style="background:${bg};padding:3px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${fg};white-space:nowrap;font-family:${FONT};">${escapeHtml(badge.label)}</td></tr>
</table>`
}

/** Word drops margin on tables and divs, so spacing has to be a real row. */
function spacer(height: number): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td></tr></table>`
}

/** bgcolor td rather than VML, so it paints in every client without xmlns:v. */
function renderButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};">
  <tr>
    <td bgcolor="${NAVY}" align="center" style="background:${NAVY};border-radius:6px;padding:11px 22px;font-family:${FONT};">
      <a href="${escapeAttr(href)}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:${FONT};">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
