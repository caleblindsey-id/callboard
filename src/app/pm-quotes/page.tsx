import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { listQuotes } from '@/lib/db/pm-quotes'
import PageHeader from '@/components/ui/PageHeader'
import PmQuotesClient from './PmQuotesClient'

export const dynamic = 'force-dynamic'

export default async function PmQuotesPage() {
  await requireRole(...MANAGER_ROLES)
  const quotes = await listQuotes()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="PM Quotes"
        subtitle="Quotes covering scheduled preventative maintenance. Build one from the PM board by selecting work orders, then mark it sent when the customer has it. Accounts set to require a quote cannot have work started until one is accepted."
      />
      <PmQuotesClient quotes={quotes} />
    </div>
  )
}
