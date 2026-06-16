'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import {
  getPushState,
  enablePush,
  disablePush,
  isIos,
  isStandalone,
  type PushState,
} from '@/lib/push/client'

// Reusable "Enable notifications" control. Used standalone in Settings and inside
// the dismissible PushPrompt on the service board. Mobile-first: 44px touch
// targets, dark-mode variants.

export default function EnablePushButton({ onChange }: { onChange?: (s: PushState) => void }) {
  const [state, setState] = useState<PushState | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getPushState().then((s) => {
      if (!alive) return
      setState(s)
      onChange?.(s)
    })
    return () => {
      alive = false
    }
    // onChange intentionally omitted — parent passes a stable callback or none.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleEnable() {
    setBusy(true)
    setError(null)
    try {
      const s = await enablePush()
      setState(s)
      onChange?.(s)
      if (s === 'denied') setError('Notifications are blocked. Enable them in your browser settings.')
    } catch {
      setError('Could not turn on notifications. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    setBusy(true)
    setError(null)
    try {
      const s = await disablePush()
      setState(s)
      onChange?.(s)
    } finally {
      setBusy(false)
    }
  }

  // iOS Safari only exposes push when installed to the home screen.
  if ((state === 'unsupported' || state === 'no-key') && isIos() && !isStandalone()) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        To get push notifications on iPhone, tap the Share button and choose{' '}
        <span className="font-medium">Add to Home Screen</span>, then open CallBoard from that icon
        and turn notifications on.
      </p>
    )
  }

  if (state === 'loading') {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking…
      </span>
    )
  }

  if (state === 'unsupported' || state === 'no-key') {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Push notifications aren’t available in this browser.
      </p>
    )
  }

  if (state === 'denied') {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Notifications are blocked. Turn them on for CallBoard in your browser/site settings, then
        reload.
      </p>
    )
  }

  const subscribed = state === 'subscribed'

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={subscribed ? handleDisable : handleEnable}
        disabled={busy}
        className={
          subscribed
            ? 'inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60'
            : 'inline-flex min-h-[44px] items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60'
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : subscribed ? (
          <BellOff className="h-4 w-4" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {subscribed ? 'Turn off notifications' : 'Turn on notifications'}
      </button>
      {subscribed && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          You’ll get a push on this device when a ticket is assigned to you.
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
