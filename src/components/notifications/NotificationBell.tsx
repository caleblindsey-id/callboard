'use client'

// In-app notification bell for technicians. Surfaces assignment notifications
// (the third channel after email + Web Push) so bench / "inside" techs who don't
// monitor email still see a ticket the moment they're in the app.
//
// No realtime exists in this app, so the bell polls GET /api/notifications on a
// 5-minute interval and refetches whenever the tab regains focus. Polling only
// runs while the tab is visible — a backgrounded tab (e.g. a shared shop device
// left logged in all day) stops polling so it doesn't burn serverless CPU for
// nothing, and catches up with an immediate fetch the moment it's foregrounded.
// Managers/coordinators have no assignment notifications, so the bell renders
// nothing for them.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { useUser } from '@/components/UserProvider'

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  entity_type: string | null
  entity_id: string | null
  read_at: string | null
  created_at: string
}

const POLL_MS = 300_000

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationBell() {
  const user = useUser()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const isTech = user?.role === 'technician'

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
      setUnread(typeof data.unreadCount === 'number' ? data.unreadCount : 0)
    } catch {
      /* transient — next poll retries */
    }
  }, [])

  // Poll every POLL_MS, but ONLY while the tab is visible — a backgrounded tab
  // stops its interval entirely (no idle serverless CPU) and catches up with an
  // immediate fetch when it regains focus. The initial load fires from a
  // setTimeout callback (not synchronously) so its setState doesn't trip the
  // react-hooks/set-state-in-effect rule — same idiom as the debounced search in
  // VendorPicker.
  useEffect(() => {
    if (!isTech) return
    let interval: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (interval === null) interval = setInterval(load, POLL_MS)
    }
    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        load()
        startPolling()
      } else {
        stopPolling()
      }
    }
    // Only begin polling if the tab is actually visible on mount.
    const initial = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        load()
        startPolling()
      }
    }, 0)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearTimeout(initial)
      stopPolling()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [isTech, load])

  // Close the dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function markRead(body: { id: string } | { all: true }) {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      /* non-fatal — optimistic UI already updated */
    }
  }

  function handleOpenItem(n: Notification) {
    // Optimistic: clear the dot + decrement the badge immediately.
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)))
      setUnread((u) => Math.max(0, u - 1))
      markRead({ id: n.id })
    }
    setOpen(false)
    if (n.url) router.push(n.url)
  }

  function handleMarkAll() {
    if (unread === 0) return
    const now = new Date().toISOString()
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: now })))
    setUnread(0)
    markRead({ all: true })
  }

  if (!isTech) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-11 w-11 items-center justify-center rounded-md text-gray-300 hover:text-white"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[0.65rem] font-semibold leading-4 text-white dark:bg-red-500">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                <Check className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenItem(n)}
                      className={`flex w-full items-start gap-2 px-3 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                        n.read_at ? '' : 'bg-blue-50/60 dark:bg-blue-900/20'
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.read_at ? 'bg-transparent' : 'bg-blue-600 dark:bg-blue-400'
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">{n.title}</span>
                        {n.body && (
                          <span className="mt-0.5 block truncate text-xs text-gray-600 dark:text-gray-300">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[0.7rem] text-gray-400 dark:text-gray-500">
                          {relativeTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
