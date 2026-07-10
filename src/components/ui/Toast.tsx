'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'

const AUTO_DISMISS_MS = 4000

interface ToastItem {
  id: number
  message: string
}

interface ToastContextValue {
  /** Show a success confirmation toast (auto-dismisses after 4s). */
  showToast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * Mount once near the root (see src/app/layout.tsx). Renders success-only,
 * auto-dismissing (4s) confirmation toasts, fixed top-right. No portal — a
 * `position: fixed` overlay doesn't need one, and nothing else in this app
 * uses a portal (ConfirmDialog is a plain fixed div too), so this stays
 * consistent with the existing convention instead of introducing a new one.
 * Deliberate per standard-draft dimension 12: Toast is for the RESULT of a
 * user action, and only the success half of that — a failure belongs in
 * `InlineError` (persistent, in-context) instead, so this component's API has
 * no error/variant prop at all. Don't add one; add an InlineError at the call
 * site instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const showToast = useCallback((message: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, AUTO_DISMISS_MS)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="flex items-center gap-2 rounded-md bg-green-600 dark:bg-green-700 text-white text-sm font-medium px-4 py-2.5 shadow-lg"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Call `showToast(message)` after a successful user-triggered action. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast() must be called within a ToastProvider (mounted in src/app/layout.tsx)')
  }
  return ctx
}
