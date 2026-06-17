'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Wrench } from 'lucide-react'
import { APP_NAME } from '@/lib/branding'
import {
  getDeviceId,
  getProfiles,
  rememberProfile,
  dismissEnroll,
  isEnrollDismissed,
  type PinProfile,
} from '@/lib/pin-device'
import PinPad from './PinPad'
import SetPinPrompt from './SetPinPrompt'

type View = 'init' | 'password' | 'pin-pick' | 'pin-entry' | 'enroll'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  // Server-side denials (proxy.ts) and expired magic links arrive as ?error=…
  const initialError =
    errorParam === 'link_expired'
      ? 'That link has expired or already been used. Please sign in again.'
      : errorParam === 'not_provisioned'
        ? 'This account is not set up in CallBoard yet. Please contact your manager.'
        : errorParam === 'deactivated'
          ? 'This account has been deactivated. Please contact your manager.'
          : null

  // Quick-PIN device state (resolved after mount — localStorage is client-only).
  const [view, setView] = useState<View>('init')
  const [deviceId, setDeviceId] = useState('')
  const [profiles, setProfiles] = useState<PinProfile[]>([])
  const [selected, setSelected] = useState<PinProfile | null>(null)

  // Password form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  // PIN entry / enrollment
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinLoading, setPinLoading] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [pendingEnroll, setPendingEnroll] = useState<PinProfile | null>(null)

  // Resolve the device + remembered profiles once, after mount.
  useEffect(() => {
    const id = getDeviceId()
    const list = getProfiles()
    setDeviceId(id)
    setProfiles(list)
    if (initialError || list.length === 0) {
      setView('password')
    } else if (list.length === 1) {
      setSelected(list[0])
      setView('pin-entry')
    } else {
      setView('pin-pick')
    }
  }, [initialError])

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    try {
      const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authError || !user) {
        setError('Invalid email or password.')
        return
      }

      // Already has a PIN on this device, or mid forced-change → just go.
      if (profiles.some((p) => p.userId === user.id)) {
        router.push('/')
        router.refresh()
        return
      }

      // Look up display name + forced-change flag (own row is readable under RLS).
      let name = user.email?.split('@')[0] ?? 'this account'
      let mustChange = false
      try {
        const { data: row } = await supabase
          .from('users')
          .select('name, must_change_password')
          .eq('id', user.id)
          .single()
        if (row?.name) name = row.name
        mustChange = !!row?.must_change_password
      } catch {
        /* fall back to email local-part */
      }

      if (mustChange) {
        // Proxy will route to /change-password; don't offer enrollment yet.
        router.push('/')
        router.refresh()
        return
      }

      // Tech previously tapped "Not now" on this device → respect it, just go.
      if (isEnrollDismissed(user.id)) {
        router.push('/')
        router.refresh()
        return
      }

      setPendingEnroll({ userId: user.id, name })
      setEnrollError(null)
      setView('enroll')
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePinLogin(pin: string) {
    if (!selected) return
    setPinError(null)
    setPinLoading(true)
    try {
      const res = await fetch('/api/auth/pin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, user_id: selected.userId, pin }),
      })
      if (res.ok) {
        router.push('/')
        router.refresh()
        return
      }
      const data = await res.json().catch(() => ({}))
      setPinError(data?.error ?? 'Incorrect PIN.')
    } catch {
      setPinError('Could not reach the server. Try again.')
    } finally {
      setPinLoading(false)
    }
  }

  async function handleEnrollSave(pin: string) {
    if (!pendingEnroll) return
    setEnrollError(null)
    setPinLoading(true)
    try {
      const res = await fetch('/api/auth/pin/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, pin, label: pendingEnroll.name }),
      })
      if (res.ok) {
        rememberProfile(pendingEnroll)
        router.push('/')
        router.refresh()
        return
      }
      const data = await res.json().catch(() => ({}))
      setEnrollError(data?.error ?? 'Could not save your PIN.')
    } catch {
      setEnrollError('Could not reach the server. Try again.')
    } finally {
      setPinLoading(false)
    }
  }

  function skipEnroll() {
    if (pendingEnroll) dismissEnroll(pendingEnroll.userId)
    router.push('/')
    router.refresh()
  }

  function goToPassword() {
    setError(null)
    setView('password')
  }

  return (
    <div className="w-full max-w-sm mx-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <Wrench className="h-6 w-6 text-gray-700 dark:text-gray-300" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
            {APP_NAME}
          </h1>
        </div>

        {/* Brief skeleton while localStorage resolves — avoids a password-form flash. */}
        {view === 'init' && <div className="h-64" />}

        {view === 'pin-entry' && selected && (
          <PinPad
            name={selected.name}
            onSubmit={handlePinLogin}
            onUsePassword={goToPassword}
            onSwitchUser={profiles.length > 1 ? () => setView('pin-pick') : undefined}
            error={pinError}
            loading={pinLoading}
          />
        )}

        {view === 'pin-pick' && (
          <div className="flex flex-col items-center">
            <p className="text-base font-semibold text-gray-900 dark:text-white mb-5">Who&apos;s this?</p>
            <div className="w-full space-y-2">
              {profiles.map((p) => (
                <button
                  key={p.userId}
                  type="button"
                  onClick={() => {
                    setSelected(p)
                    setPinError(null)
                    setView('pin-entry')
                  }}
                  className="w-full rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3 text-left text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={goToPassword}
              className="mt-5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Add another account
            </button>
          </div>
        )}

        {view === 'enroll' && pendingEnroll && (
          <SetPinPrompt
            onSave={handleEnrollSave}
            onSkip={skipEnroll}
            error={enrollError}
            loading={pinLoading}
          />
        )}

        {view === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500 dark:focus:ring-slate-400 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500 dark:focus:ring-slate-400 focus:border-transparent"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="text-center pt-1">
              <Link href="/forgot-password" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                Forgot password?
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm mx-4 h-72" />}>
      <LoginForm />
    </Suspense>
  )
}
