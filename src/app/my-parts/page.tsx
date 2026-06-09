import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getMyPartsQueue } from '@/lib/db/parts-queue'
import MyPartsClient from './MyPartsClient'

export const dynamic = 'force-dynamic'

export default async function MyPartsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const rows = await getMyPartsQueue(user.id)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">My Parts</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Parts on your PM and service tickets — what&apos;s ready for pickup, on order, and awaiting order.
        </p>
      </div>
      <MyPartsClient rows={rows} initialTab={params.tab ?? ''} />
    </div>
  )
}
