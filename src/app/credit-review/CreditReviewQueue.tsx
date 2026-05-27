'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, ChevronRight } from 'lucide-react'
import type { CreditReviewQueueItem } from '@/lib/db/credit-reviews'
import UnblockCreditPanel from '@/components/UnblockCreditPanel'

const STALE_MS = 48 * 60 * 60 * 1000

function ageLabel(iso: string): { text: string; stale: boolean } {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const text = days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : 'just now'
  return { text, stale: ms > STALE_MS }
}

function TypeChip({ type }: { type: 'pm' | 'service' }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
        type === 'pm'
          ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
          : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
      }`}
    >
      {type === 'pm' ? 'PM' : 'Svc'}
    </span>
  )
}

function PendingRow({ item }: { item: CreditReviewQueueItem }) {
  const router = useRouter()
  const [resending, setResending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const age = ageLabel(item.createdAt)

  async function handleResend() {
    setResending(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/credit-reviews/${item.id}/resend`, { method: 'POST' })
      if (res.ok) {
        setMsg('Resent')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setMsg(data.error ?? 'Failed')
      }
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <TypeChip type={item.ticketType} />
      <div className="flex-1 min-w-[180px]">
        {item.ticketHref ? (
          <Link href={item.ticketHref} className="text-sm font-medium text-slate-700 dark:text-slate-200 hover:underline inline-flex items-center gap-1">
            {item.orderLabel} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="text-sm font-medium text-gray-900 dark:text-white">{item.orderLabel}</span>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {item.customerName}
          {item.accountNumber ? ` · ${item.accountNumber}` : ''}
        </p>
      </div>
      <span className="text-sm text-gray-600 dark:text-gray-400 w-20 text-right">{item.amountLabel}</span>
      <span
        className={`text-xs w-20 text-right ${
          age.stale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-500 dark:text-gray-400'
        }`}
        title={item.emailedAt ? `AR emailed ${new Date(item.emailedAt).toLocaleString()}` : 'Not emailed yet'}
      >
        {age.stale ? '⚠ ' : ''}{age.text}
      </span>
      <div className="flex items-center gap-2">
        {!item.emailedAt && (
          <span className="text-xs text-amber-600 dark:text-amber-400">not emailed</span>
        )}
        <button
          onClick={handleResend}
          disabled={resending}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          <Mail className="h-3.5 w-3.5" />
          {resending ? '…' : 'Resend AR'}
        </button>
        {msg && <span className="text-xs text-gray-500 dark:text-gray-400">{msg}</span>}
      </div>
    </div>
  )
}

function BlockedRow({ item }: { item: CreditReviewQueueItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TypeChip type={item.ticketType} />
        <div className="flex-1 min-w-[180px]">
          {item.ticketHref ? (
            <Link href={item.ticketHref} className="text-sm font-medium text-slate-700 dark:text-slate-200 hover:underline inline-flex items-center gap-1">
              {item.orderLabel} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="text-sm font-medium text-gray-900 dark:text-white">{item.orderLabel}</span>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {item.customerName}
            {item.accountNumber ? ` · ${item.accountNumber}` : ''}
            {item.decidedByName ? ` · blocked by ${item.decidedByName}` : ''}
          </p>
        </div>
        <span className="text-sm text-gray-600 dark:text-gray-400 w-20 text-right">{item.amountLabel}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
        >
          🔒 {open ? 'Close' : 'Unblock'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <UnblockCreditPanel
            reviewId={item.id}
            blockReason={item.blockReason}
            decidedByName={item.decidedByName}
            onUnblocked={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

export default function CreditReviewQueue({
  pending,
  blocked,
}: {
  pending: CreditReviewQueueItem[]
  blocked: CreditReviewQueueItem[]
}) {
  if (pending.length === 0 && blocked.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-10 text-center text-sm text-gray-500 dark:text-gray-400">
        No orders are awaiting credit review.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-950/20">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Pending AR review ({pending.length})
          </h2>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Awaiting AR&apos;s release/block decision. Oldest first.
          </p>
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">None pending.</div>
        ) : (
          pending.map((item) => <PendingRow key={item.id} item={item} />)
        )}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-red-50 dark:bg-red-950/20">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
            Blocked by AR ({blocked.length})
          </h2>
          <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-0.5">
            Work is locked until a manager unblocks with the release passcode.
          </p>
        </div>
        {blocked.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">None blocked.</div>
        ) : (
          blocked.map((item) => <BlockedRow key={item.id} item={item} />)
        )}
      </section>
    </div>
  )
}
