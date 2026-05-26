import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getOpenCreditReviews } from '@/lib/db/credit-reviews'
import CreditReviewQueue from './CreditReviewQueue'

export default async function CreditReviewPage() {
  await requireRole(...MANAGER_ROLES)
  const reviews = await getOpenCreditReviews()
  const pending = reviews.filter((r) => r.status === 'pending')
  const blocked = reviews.filter((r) => r.status === 'blocked')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Credit Review</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Orders gated pending AR credit approval. AR decides by email; managers can unblock blocked
          orders with the release passcode.
        </p>
      </div>
      <CreditReviewQueue pending={pending} blocked={blocked} />
    </div>
  )
}
