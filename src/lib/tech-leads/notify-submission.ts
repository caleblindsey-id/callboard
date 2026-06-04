// Notify every active manager the moment a technician files a lead. Mirrors the
// non-fatal credit-review notification pattern (src/lib/credit-review.ts): the
// caller (POST /api/tech-leads) awaits this inside a try/catch, so a send failure
// logs but never fails the tech's submission.
//
// Recipients: users with role 'manager' or 'super_admin' (the roles that act on
// leads in /tech-leads). Coordinators are read-only and not notified. The
// submitter is excluded so a manager filing on a tech's behalf doesn't ping
// themselves.

import { getUsers } from '@/lib/db/users'
import { getSetting } from '@/lib/db/settings'
import { sendMandrillEmail } from '@/lib/mandrill'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTechLeadSubmittedEmail } from '@/lib/email-templates/tech-lead-submitted'

export type NotifyLeadSubmissionArgs = {
  leadId: string
  submittedById: string
  techName: string
  customerName: string
  leadTypeLabel: string
  equipmentDescription: string
  contact: {
    name: string | null
    email: string | null
    phone: string | null
  }
  notes: string | null
}

export async function notifyManagersOfLeadSubmission(
  args: NotifyLeadSubmissionArgs
): Promise<void> {
  const users = await getUsers(true)
  const managers = users.filter(
    (u) =>
      u.id !== args.submittedById &&
      (u.role === 'manager' || u.role === 'super_admin') &&
      u.email
  )
  if (managers.length === 0) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const reviewUrl = `${appUrl}/tech-leads`
  const companyName = (await getSetting('company_name')) ?? 'CallBoard'

  const email = renderTechLeadSubmittedEmail({
    techName: args.techName,
    customerName: args.customerName,
    leadTypeLabel: args.leadTypeLabel,
    equipmentDescription: args.equipmentDescription,
    contact: args.contact,
    notes: args.notes,
    reviewUrl,
    companyName,
  })

  const result = await sendMandrillEmail({
    to: { email: managers[0].email, name: managers[0].name },
    cc: managers.slice(1).map((m) => ({ email: m.email, name: m.name })),
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: ['tech-lead-submitted'],
    metadata: {
      tech_lead_id: args.leadId,
      submitted_by_id: args.submittedById,
    },
  })

  // Audit (non-fatal). The tech's RLS client can't UPDATE tech_leads, so use the
  // service-role client. SERVER_ONLY (not ADMIN_ONLY) because this path is
  // reachable by technicians — see memory: admin-client-guard-modes.
  try {
    const admin = await createAdminClient('SERVER_ONLY')
    await admin
      .from('tech_leads')
      .update({
        submit_notified_at: new Date().toISOString(),
        submit_notify_message_id: result.messageId,
      })
      .eq('id', args.leadId)
  } catch (err) {
    console.error('tech-lead submit notification audit write failed:', err)
  }
}
