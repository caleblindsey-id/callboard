'use client'

import { useState } from 'react'
import NumberPad, { PIN_MIN } from './NumberPad'
import { pinPolicyError } from '@/lib/pin-policy'

type Props = {
  /** Called with the confirmed PIN; parent persists via /api/auth/pin/enroll. */
  onSave: (pin: string) => void
  onSkip: () => void
  /** Server-side error from the enroll call. */
  error: string | null
  loading: boolean
}

// Post-login enrollment: "Set a quick PIN for this device?" Two-step (enter then
// confirm). Weak PINs are rejected client-side for instant feedback; the server
// re-validates on enroll.
export default function SetPinPrompt({ onSave, onSkip, error, loading }: Props) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [first, setFirst] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function next() {
    const policy = pinPolicyError(first)
    if (policy) {
      setLocalError(policy)
      return
    }
    setLocalError(null)
    setStep('confirm')
  }

  function finish() {
    if (confirm !== first) {
      setLocalError("PINs didn't match. Try again.")
      setFirst('')
      setConfirm('')
      setStep('enter')
      return
    }
    setLocalError(null)
    onSave(first)
  }

  const value = step === 'enter' ? first : confirm
  const setValue = step === 'enter' ? setFirst : setConfirm
  const shownError = localError ?? error

  return (
    <div className="flex flex-col items-center">
      <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">
        Set a quick PIN
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 text-center px-2">
        {step === 'enter'
          ? 'Sign in faster on this device next time. 4 to 6 digits.'
          : 'Re-enter your PIN to confirm.'}
      </p>

      <NumberPad value={value} onChange={setValue} disabled={loading} />

      <p className="text-sm text-red-600 dark:text-red-400 mt-3 min-h-[1.25rem] text-center" role="alert">
        {shownError ?? ''}
      </p>

      {step === 'enter' ? (
        <button
          type="button"
          onClick={next}
          disabled={first.length < PIN_MIN || loading}
          className="mt-1 w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          Continue
        </button>
      ) : (
        <button
          type="button"
          onClick={finish}
          disabled={confirm.length < PIN_MIN || loading}
          className="mt-1 w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : 'Save PIN'}
        </button>
      )}

      <button
        type="button"
        onClick={onSkip}
        disabled={loading}
        className="mt-4 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
      >
        Not now
      </button>
    </div>
  )
}
