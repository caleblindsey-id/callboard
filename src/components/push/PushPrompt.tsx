'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import EnablePushButton from './EnablePushButton'
import { getPushState } from '@/lib/push/client'

const DISMISS_KEY = 'cb_push_prompt_dismissed'

// Dismissible banner shown at the top of the service board nudging techs to turn
// on assignment push. Hides itself once the device is subscribed, once dismissed
// (persisted in localStorage), or when push isn't usable at all (so we don't show
// a dead banner on, say, desktop Safari) — except the iOS "install first" case,
// which is worth surfacing.
export default function PushPrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let alive = true
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1') return
    getPushState().then((s) => {
      if (!alive) return
      // Show when the user could meaningfully act: not yet subscribed, and either
      // supported or the iOS-install hint (state 'unsupported' + iOS handled by
      // the button). Hide on 'subscribed' and 'no-key'.
      if (s === 'default' || s === 'denied' || s === 'unsupported') setVisible(true)
    })
    return () => {
      alive = false
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* private mode — fine, it just won't persist */
    }
  }

  if (!visible) return null

  return (
    <div className="relative rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <Bell className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Get notified when a ticket is assigned to you
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Turn on push notifications so new work shows up the moment it lands on your board.
            </p>
          </div>
          {/* Once the device subscribes, hide the whole banner. */}
          <EnablePushButton onChange={(s) => { if (s === 'subscribed') setVisible(false) }} />
        </div>
      </div>
    </div>
  )
}
