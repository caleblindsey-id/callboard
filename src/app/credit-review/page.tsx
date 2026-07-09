import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getOpenCreditReviews } from '@/lib/db/credit-reviews'
import CreditReviewQueue from './CreditReviewQueue'
import PageHeader from '@/components/ui/PageHeader'

export default async function CreditReviewPage() {
  await requireRole(...MANAGER_ROLES)
  const reviews = await getOpenCreditReviews()
  const pending = reviews.filter((r) => r.status === 'pending')
  const blocked = reviews.filter((r) => r.status === 'blocked')

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Credit Review"
        subtitle="Orders gated pending AR credit approval. AR decides by email; managers can unblock blocked orders with the release passcode."
      />
      <CreditReviewQueue pending={pending} blocked={blocked} />
    </div>
  )
}
