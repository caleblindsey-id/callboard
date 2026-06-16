// Browser-side Web Push helpers: register the service worker, subscribe/
// unsubscribe, and report state for the UI. Client-only — never import from a
// server module. All functions are safe to call in unsupported browsers (they
// return a sensible state instead of throwing).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  | 'unsupported'   // no service worker / Push API (e.g. iOS Safari not installed to home screen)
  | 'no-key'        // VAPID public key not configured in the build
  | 'denied'        // user blocked notifications
  | 'subscribed'    // active push subscription on this device
  | 'default'       // supported + permitted-or-unasked, not yet subscribed

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

// iOS only fires push when the site is installed to the home screen (standalone).
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'no-key'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub ? 'subscribed' : 'default'
  } catch {
    return 'default'
  }
}

// Request permission (if needed), subscribe, and persist on the server.
// Returns the resulting state.
export async function enablePush(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'no-key'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'

  const reg = await getRegistration()
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: lib.dom types applicationServerKey as BufferSource backed by a
      // strict ArrayBuffer; our Uint8Array is ArrayBufferLike under TS 5.7.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) throw new Error('Failed to save push subscription')
  return 'subscribed'
}

export async function disablePush(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      const endpoint = sub.endpoint
      await sub.unsubscribe()
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    }
  } catch (err) {
    console.error('disablePush failed', err)
  }
  return 'default'
}
