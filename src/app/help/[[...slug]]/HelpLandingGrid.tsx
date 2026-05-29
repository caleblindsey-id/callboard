'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { HelpNavGroup } from '@/lib/help'

interface HelpLandingGridProps {
  groups: HelpNavGroup[]
  // Categories always shown up top. The rest go behind "Show all guides" when collapsible.
  primaryCategories: string[]
  // Techs land here on a phone — collapse the categories they can't act on by default.
  collapsible: boolean
}

export default function HelpLandingGrid({ groups, primaryCategories, collapsible }: HelpLandingGridProps) {
  const [showAll, setShowAll] = useState(false)

  const primary = collapsible ? groups.filter((g) => primaryCategories.includes(g.category)) : groups
  const rest = collapsible ? groups.filter((g) => !primaryCategories.includes(g.category)) : []

  return (
    <div className="space-y-5">
      <div className="grid gap-6 sm:grid-cols-2">
        {primary.map((group) => (
          <CategorySection key={group.category} group={group} />
        ))}
      </div>

      {collapsible && rest.length > 0 && showAll && (
        <div className="grid gap-6 sm:grid-cols-2">
          {rest.map((group) => (
            <CategorySection key={group.category} group={group} />
          ))}
        </div>
      )}

      {collapsible && rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="flex w-full min-h-11 items-center justify-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {showAll ? 'Show fewer guides' : 'Show all guides'}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${showAll ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

function CategorySection({ group }: { group: HelpNavGroup }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {group.category}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {group.pages.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:underline"
            >
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
