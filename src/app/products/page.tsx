import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PageHeader from '@/components/ui/PageHeader'
import ProductList from './ProductList'

export default async function ProductsPage() {
  await requireRole(...MANAGER_ROLES, 'technician')
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Products" subtitle="Synced from SynergyERP — read only" />
      <ProductList />
    </div>
  )
}
