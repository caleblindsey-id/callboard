import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getMyPartsQueue } from '@/lib/db/parts-queue'
import PageHeader from '@/components/ui/PageHeader'
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
      <PageHeader
        title="My Parts"
        subtitle="Parts on your PM and service tickets — what's ready for pickup, on order, and awaiting order."
      />
      <MyPartsClient rows={rows} initialTab={params.tab ?? ''} />
    </div>
  )
}
