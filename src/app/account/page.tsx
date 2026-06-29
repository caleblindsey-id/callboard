'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useUser } from '@/components/UserProvider'
import { getStoredDeviceId, rememberProfile, forgetProfile } from '@/lib/pin-device'
import SetPinPrompt from '@/app/login/SetPinPrompt'

export default function AccountPage() {
  const user = useUser()
  const [deviceId, setDeviceId] = useState('')
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [mode, setMode] = useState<'view' | 'set'>('view')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    // Device id now lives in the durable httpOnly cb-did cookie; the status call
    // resolves/issues it (adopting the legacy localStorage id once if present) and
    // reports enrollment for the current user.
    const legacy = getStoredDeviceId()
    const qs = legacy ? `?adopt=${encodeURIComponent(legacy)}` : ''
    fetch(`/api/auth/pin/status${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enrolledForCurrentUser: false }))
      .then((d) => {
        setDeviceId(d.device_id ?? '')
        setEnrolled(!!d.enrolledForCurrentUser)
      })
      .catch(() => setEnrolled(false))
  }, [])

  async function handleSave(pin: string) {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/pin/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, pin, label: user.name }),
      })
      if (res.ok) {
        rememberProfile({ userId: user.id, name: user.name })
        setEnrolled(true)
        setMode('view')
        setMessage('Your PIN is set on this device.')
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data?.error ?? 'Could not save your PIN.')
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/pin/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      })
      if (res.ok) {
        forgetProfile(user.id)
        setEnrolled(false)
        setConfirmRemove(false)
        setMessage('Your PIN was removed from this device.')
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data?.error ?? 'Could not remove the PIN.')
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2.5 mb-6">
        <ShieldCheck className="h-6 w-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Account Security</h1>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Quick PIN</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
          Set a 4 to 6 digit PIN to sign in fast on this device. Your PIN only works on this
          device and never replaces your password. Lost your phone? Ask a manager to reset it.
        </p>

        {message && (
          <p className="text-sm text-green-700 dark:text-green-400 mb-4" role="status">{message}</p>
        )}

        {mode === 'set' ? (
          <div className="py-2">
            <SetPinPrompt
              onSave={handleSave}
              onSkip={() => {
                setMode('view')
                setError(null)
              }}
              error={error}
              loading={busy}
            />
          </div>
        ) : enrolled === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Checking…</p>
        ) : enrolled ? (
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              A quick PIN is set on this device.
            </p>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3" role="alert">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => { setMode('set'); setMessage(null); setError(null) }}
                disabled={busy}
                className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                Change PIN
              </button>
              {confirmRemove ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-gray-700 dark:text-gray-300">Remove PIN from this device?</span>
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={busy}
                    className="font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    {busy ? 'Removing…' : 'Yes, remove'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setConfirmRemove(true); setMessage(null); setError(null) }}
                  disabled={busy}
                  className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Remove PIN
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              No quick PIN is set on this device.
            </p>
            <button
              type="button"
              onClick={() => { setMode('set'); setMessage(null); setError(null) }}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              Set a PIN
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
