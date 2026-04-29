import Link from 'next/link'
import { PackageSearch, Truck, PackageCheck } from 'lucide-react'
import ZoneHeader from './ZoneHeader'

type Card = {
  title: string
  total: number
  pm: number
  service: number
  icon: typeof PackageSearch
  iconColor: string
  emphasized?: boolean
  href: string
}

function PartsCard({ card }: { card: Card }) {
  const Icon = card.icon
  const emphasis = card.emphasized
    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 hover:border-emerald-300 dark:hover:border-emerald-800'
    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
  return (
    <Link
      href={card.href}
      className={`block rounded-lg shadow-sm border p-4 hover:shadow transition-all ${emphasis}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${card.iconColor}`} />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {card.title}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
            {card.total}
          </p>
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
          <div>PM <span className="text-gray-700 dark:text-gray-200 font-medium tabular-nums">{card.pm}</span></div>
          <div>Service <span className="text-gray-700 dark:text-gray-200 font-medium tabular-nums">{card.service}</span></div>
        </div>
      </div>
    </Link>
  )
}

type Props = {
  isTech: boolean
  pmPartsToOrder: number
  pmPartsOnOrder: number
  pmPartsReady: number
  svcPartsToOrder: number
  svcPartsOnOrder: number
  svcPartsReady: number
}

export default function PartsPipeline(props: Props) {
  const partsHref = props.isTech ? '/tickets' : '/parts-queue'
  const cols = props.isTech ? 'sm:grid-cols-2' : 'sm:grid-cols-3'

  const cards: Card[] = []
  if (!props.isTech) {
    cards.push({
      title: 'Parts to Order',
      total: props.pmPartsToOrder + props.svcPartsToOrder,
      pm: props.pmPartsToOrder,
      service: props.svcPartsToOrder,
      icon: PackageSearch,
      iconColor: 'text-amber-500',
      href: partsHref,
    })
  }
  cards.push({
    title: 'Parts on Order',
    total: props.pmPartsOnOrder + props.svcPartsOnOrder,
    pm: props.pmPartsOnOrder,
    service: props.svcPartsOnOrder,
    icon: Truck,
    iconColor: 'text-orange-500',
    href: partsHref,
  })
  cards.push({
    title: 'Ready for Pickup',
    total: props.pmPartsReady + props.svcPartsReady,
    pm: props.pmPartsReady,
    service: props.svcPartsReady,
    icon: PackageCheck,
    iconColor: 'text-green-500',
    emphasized: true,
    href: partsHref,
  })

  return (
    <section>
      <ZoneHeader label="Parts Pipeline" />
      <div className={`grid grid-cols-1 ${cols} gap-3 sm:gap-4`}>
        {cards.map((c) => <PartsCard key={c.title} card={c} />)}
      </div>
    </section>
  )
}
