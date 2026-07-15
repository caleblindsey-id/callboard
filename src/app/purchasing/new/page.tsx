import { requireRole } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import type { ReorderScopeType } from '@/types/reorder'
import NewWalkForm from './NewWalkForm'

// Sub-flow off the Purchasing list, not a sidebar-reachable top-level page —
// mirrors /service/new's convention (thin server wrapper, self-contained
// client form owns its own header) rather than the flat list-page shell.
export default async function NewReorderWalkPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>
}) {
  await requireRole(...PURCHASING_ROLES)
  const params = await searchParams
  return <NewWalkForm initialScope={params.scope as ReorderScopeType | undefined} />
}
