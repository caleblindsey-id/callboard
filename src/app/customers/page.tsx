import { getCustomers } from '@/lib/db/customers'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import CustomerList from './CustomerList'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const params = await searchParams
  const customers = await getCustomers() // first 50, ordered by name

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Customers</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Synced from SynergyERP — read only
        </p>
      </div>
      <CustomerList customers={customers} initialSearch={params.q ?? ''} />
    </div>
  )
}
