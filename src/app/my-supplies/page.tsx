import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getSupplyCatalog, getMySupplyRequests } from '@/lib/db/supply-requests'
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Request Supplies</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ask the warehouse to pull shop supplies (WD-40, grease, gloves, wipers, and more) so they&apos;re ready for you.
        </p>
      </div>
      <MySuppliesClient catalog={catalog} requests={requests} />
    </div>
  )
}
