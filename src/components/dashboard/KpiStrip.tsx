import Link from 'next/link'

type Tone = 'blue' | 'red' | 'amber' | 'purple' | 'emerald'

const tones: Record<Tone, { card: string; label: string }> = {
  blue: {
    card: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
    label: 'text-blue-700 dark:text-blue-300',
  },
  red: {
    card: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
    label: 'text-red-700 dark:text-red-300',
  },
  amber: {
    card: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    label: 'text-amber-700 dark:text-amber-300',
  },
  purple: {
    card: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
    label: 'text-purple-700 dark:text-purple-300',
  },
  emerald: {
    card: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    label: 'text-emerald-700 dark:text-emerald-300',
  },
}

export type KpiCardProps = {
  label: string
  value: string
  subtitle?: string
  tone: Tone
  href?: string
}

function KpiCard({ label, value, subtitle, tone, href }: KpiCardProps) {
  const t = tones[tone]
  const inner = (
    <>
      <div className={`text-xs uppercase tracking-wide font-medium ${t.label}`}>{label}</div>
      <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{subtitle}</div>
      )}
    </>
  )
  const className = `block rounded-lg border p-4 ${t.card} ${href ? 'hover:shadow transition-shadow' : ''}`
  if (href) return <Link href={href} className={className}>{inner}</Link>
  return <div className={className}>{inner}</div>
}

export default function KpiStrip({ cards }: { cards: KpiCardProps[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => <KpiCard key={c.label} {...c} />)}
    </div>
  )
}
