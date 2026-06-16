'use client'

import { useState } from 'react'
import NumberPad, { PIN_MIN } from './NumberPad'

type Props = {
  /** Name shown above the pad ("Enter PIN for Jacob"). */
  name: string
  onSubmit: (pin: string) => void
  onUsePassword: () => void
  /** Optional "switch user" affordance on a shared device. */
  onSwitchUser?: () => void
  error: string | null
  loading: boolean
}

// Login-time PIN entry. Masked dots + numeric pad; Sign In enables at 4 digits.
export default function PinPad({ name, onSubmit, onUsePassword, onSwitchUser, error, loading }: Props) {
  const [pin, setPin] = useState('')

  function submit() {
    if (pin.length >= PIN_MIN && !loading) onSubmit(pin)
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">Enter PIN for</p>
      <p className="text-base font-semibold text-gray-900 dark:text-white mb-5">{name}</p>

      <NumberPad value={pin} onChange={setPin} disabled={loading} />

      <p className="text-sm text-red-600 dark:text-red-400 mt-3 min-h-[1.25rem] text-center" role="alert">
        {error ?? ''}
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={pin.length < PIN_MIN || loading}
        className="mt-1 w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>

      <div className="mt-4 flex flex-col items-center gap-2">
        {onSwitchUser && (
          <button
            type="button"
            onClick={onSwitchUser}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Switch user
          </button>
        )}
        <button
          type="button"
          onClick={onUsePassword}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Use password instead
        </button>
      </div>
    </div>
  )
}
