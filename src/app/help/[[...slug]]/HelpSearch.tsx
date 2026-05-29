'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

interface SearchResult {
  href: string
  title: string
  category: string
  summary: string
}

export default function HelpSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search against the server endpoint.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/help/search?q=${encodeURIComponent(q.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.results ?? [])
          setOpen(true)
        }
      } catch {
        // Search is a convenience; a failed fetch just shows no results.
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  // Close the results dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function go(href: string) {
    setOpen(false)
    setQ('')
    router.push(href)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true) }}
          placeholder="Search the guides…"
          className="w-full rounded-md border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-96 overflow-auto">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
              {loading ? 'Searching…' : 'No matching guides.'}
            </p>
          ) : (
            <ul className="py-1">
              {results.map((r) => (
                <li key={r.href}>
                  <button
                    type="button"
                    onClick={() => go(r.href)}
                    className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">{r.title}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {r.category}{r.summary ? ` — ${r.summary}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
