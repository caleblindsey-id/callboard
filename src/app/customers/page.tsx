import { getCustomers } from '@/lib/db/customers'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PageHeader from '@/components/ui/PageHeader'
import CustomerList from './CustomerList'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const params = await searchParams
  const { customers, total } = await getCustomers() // first 50, ordered by name

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Customers" subtitle="Synced from SynergyERP — read only" />
      <CustomerList customers={customers} initialTotal={total} initialSearch={params.q ?? ''} />
    </div>
  )
}
