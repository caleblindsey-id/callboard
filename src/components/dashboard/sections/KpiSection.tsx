import KpiStrip, { type KpiCardProps } from '@/components/dashboard/KpiStrip'
import { getOverdueTicketCount } from '@/lib/db/tickets'
import {
  getPartsToOrderCount,
  getPartsToReviewCount,
  getPartsOnOrderCount,
} from '@/lib/db/service-tickets'
import {
  getOpenWorkCounts,
  getPendingApproval,
  getMtdRevenue,
  getCreditHoldCount,
} from '@/lib/db/dashboard-metrics'

function fmtMoneyShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default async function KpiSection() {
  const [
    openWork,
    pendingApproval,
    mtdRevenue,
    creditHoldCount,
    overdueCount,
    pmPartsToReview,
    pmPartsToOrder,
    pmPartsOnOrder,
    svcPartsToReview,
    svcPartsToOrder,
    svcPartsOnOrder,
  ] = await Promise.all([
    getOpenWorkCounts(),
    getPendingApproval(),
    getMtdRevenue(),
    getCreditHoldCount(),
    getOverdueTicketCount(),
    getPartsToReviewCount('pm'),
    getPartsToOrderCount('pm'),
    getPartsOnOrderCount(undefined, 'pm'),
    getPartsToReviewCount('service'),
    getPartsToOrderCount('service'),
    getPartsOnOrderCount(undefined, 'service'),
  ])

  const moneyAtRiskTotal = creditHoldCount + overdueCount
  // Parts in review, awaiting order, or on order all keep a ticket waiting.
  const partsBlocked =
    pmPartsToReview + pmPartsToOrder + pmPartsOnOrder +
    svcPartsToReview + svcPartsToOrder + svcPartsOnOrder

  const cards: KpiCardProps[] = [
    {
      label: 'Open Work',
      value: openWork.total.toLocaleString('en-US'),
      subtitle: `PM ${openWork.pm} · Svc ${openWork.service}`,
      tone: 'blue',
      href: '/tickets',
    },
    {
      label: 'Money at Risk',
      value: moneyAtRiskTotal.toLocaleString('en-US'),
      subtitle: `${creditHoldCount} on hold · ${overdueCount} overdue`,
      tone: 'red',
      href: '/tickets?overdue=1',
    },
    {
      label: 'Pending Approval',
      value: fmtMoneyShort(pendingApproval.amount),
      subtitle: `${pendingApproval.count} estimates awaiting signature`,
      tone: 'amber',
      href: '/service?status=estimated',
    },
    {
      label: 'Parts Blocked',
      value: partsBlocked.toLocaleString('en-US'),
      subtitle: 'Tickets waiting on parts',
      tone: 'purple',
      href: '/parts-queue',
    },
    {
      label: 'MTD Revenue',
      value: fmtMoneyShort(mtdRevenue.total),
      subtitle: `PM ${fmtMoneyShort(mtdRevenue.pm)} · Svc ${fmtMoneyShort(mtdRevenue.service)}`,
      tone: 'emerald',
    },
  ]

  return <KpiStrip cards={cards} />
}
