'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, X, Search, AlertCircle, Check, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'

type CustomerOption = {
  id: number
  name: string
  account_number: string | null
}

interface Props {
  // POST endpoint that repoints the bill-to. Service and PM use different routes.
  billToUrl: string
  currentCustomerId: number | null
  // Display label for the current account, e.g. "ACME (12345)".
  currentLabel: string
  // True when the ticket is already keyed in Synergy (order/invoice #). The
  // server hard-blocks these; we surface a locked note instead of a live control.
  locked?: boolean
}

type View = 'closed' | 'pick' | 'confirm'

function customerLabel(name: string, accountNumber: string | null): string {
  return accountNumber ? `${name} (${accountNumber})` : name
}

export default function ChangeBillToSection({
  billToUrl,
  currentCustomerId,
  currentLabel,
  locked = false,
}: Props) {
  const router = useRouter()
  const [view, setView] = useState<View>('closed')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CustomerOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<CustomerOption | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced customer search by name or account number (active accounts only).
  useEffect(() => {
    if (view !== 'pick') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const term = search.trim()
      if (!term) {
        setResults([])
        return
      }
      setSearching(true)
      const supabase = createClient()
      const q = sanitizeOrValue(term)
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number')
        .or(
          safeOrRaw([
            { column: 'name', op: 'ilike', raw: `%${q}%` },
            { column: 'account_number', op: 'ilike', raw: `%${q}%` },
          ])
        )
        .eq('active', true)
        .order('name')
        .limit(25)
      setResults((data as CustomerOption[]) ?? [])
      setSearching(false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, view])

  function open() {
    setError(null)
    setSuccessMsg(null)
    setSearch('')
    setResults([])
    setSelected(null)
    setView('pick')
  }
  function close() {
    setView('closed')
    setError(null)
    setSelected(null)
  }

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(billToUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: selected.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to change bill-to')
      setView('closed')
      setSuccessMsg('Bill-to updated.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change bill-to')
    } finally {
      setSubmitting(false)
    }
  }

  if (locked) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Lock className="h-3.5 w-3.5" />
        Already keyed in Synergy — correct the bill-to in Synergy.
      </p>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 min-h-[44px] sm:min-h-0 px-2 -mx-2"
      >
        <Building2 className="h-4 w-4" />
        Change bill-to
      </button>

      {successMsg && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Check className="h-4 w-4" /> {successMsg}
        </p>
      )}

      {view === 'pick' && (
        <SheetShell title="Change Bill-To Account" onClose={close}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Currently billing: <span className="font-medium text-gray-700 dark:text-gray-300">{currentLabel}</span>
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account name or number..."
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searching && <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Searching...</p>}
            {!searching && search.trim() && results.length === 0 && (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No active accounts match.</p>
            )}
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {results
                .filter((c) => c.id !== currentCustomerId)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(c)
                        setError(null)
                        setView('confirm')
                      }}
                      className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 min-h-[56px]"
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{c.account_number ?? '—'}</p>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </SheetShell>
      )}

      {view === 'confirm' && selected && (
        <SheetShell title="Confirm Bill-To Change" onClose={close} onBack={() => setView('pick')}>
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              This repoints who the work order bills to. The current ship-to is cleared if it
              doesn&apos;t belong to the new account.
            </p>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">New bill-to</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {customerLabel(selected.name, selected.account_number)}
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" /> {error}
              </p>
            )}
          </div>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
            <button
              type="button"
              onClick={() => setView('pick')}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 min-h-[44px]"
            >
              {submitting ? 'Saving...' : 'Change Bill-To'}
            </button>
          </div>
        </SheetShell>
      )}
    </>
  )
}

function SheetShell({
  title,
  onClose,
  onBack,
  children,
}: {
  title: string
  onClose: () => void
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-gray-800 sm:rounded-lg rounded-t-2xl shadow-lg border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 -m-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
