'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import type { HelpNavGroup } from '@/lib/help'

interface HelpNavProps {
  groups: HelpNavGroup[]
  // Categories expanded on first render (Overview + the reader's role section).
  defaultOpen: string[]
}

export default function HelpNav({ groups, defaultOpen }: HelpNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const g of groups) initial[g.category] = defaultOpen.includes(g.category)
    return initial
  })

  function toggle(category: string) {
    setOpen((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  return (
    <nav className="lg:sticky lg:top-6 space-y-3 text-sm" aria-label="Help topics">
      <Link
        href="/help"
        className={`block px-3 py-2 rounded-md font-medium transition-colors ${
          pathname === '/help'
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        All guides
      </Link>

      {groups.map((group) => {
        const isOpen = open[group.category] ?? false
        return (
          <div key={group.category}>
            <button
              type="button"
              onClick={() => toggle(group.category)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {group.category}
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
            </button>
            {isOpen && (
              <ul className="mt-1 space-y-0.5">
                {group.pages.map((page) => {
                  const isActive = pathname === page.href
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        className={`block pl-5 pr-3 py-2 rounded-md transition-colors ${
                          isActive
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        {page.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
