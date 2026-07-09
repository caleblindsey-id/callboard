import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getSupplyCatalog, getMySupplyRequests } from '@/lib/db/supply-requests'
import PageHeader from '@/components/ui/PageHeader'
import MySuppliesClient from './MySuppliesClient'

export const dynamic = 'force-dynamic'

export default async function MySuppliesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [catalog, requests] = await Promise.all([
    getSupplyCatalog(),
    getMySupplyRequests(user.id),
  ])

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Request Supplies"
        subtitle="Ask the warehouse to pull shop supplies (WD-40, grease, gloves, wipers, and more) so they're ready for you."
      />
      <MySuppliesClient catalog={catalog} requests={requests} />
    </div>
  )
}
