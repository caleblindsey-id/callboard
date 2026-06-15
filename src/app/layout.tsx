import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import LayoutShell from '@/components/LayoutShell'
import { UserProvider } from '@/components/UserProvider'
import { getCurrentUser } from '@/lib/auth'
import { APP_NAME } from '@/lib/branding'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Service operations for distributors — PMs, service tickets, estimates, leads, and tech KPIs',
  manifest: '/manifest.webmanifest',
  // Enables iOS "Add to Home Screen" as a standalone PWA — the only way Safari
  // delivers Web Push (iOS 16.4+).
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Cookie refresh is handled by the proxy on cookie-miss (src/proxy.ts) — no
  // need to duplicate the role + must-change-pw cookie set on every page load.
  // getCurrentUser() is cached per-request, so layout + page share one fetch.
  const dbUser = await getCurrentUser()

  const userContext = dbUser?.role
    ? { id: dbUser.id, role: dbUser.role, name: dbUser.name }
    : null

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-gray-50">
        {process.env.VERCEL_ENV === 'preview' && (
          <div className="bg-amber-500 text-white text-center text-sm font-semibold py-1.5 tracking-wide">
            Preview Site
          </div>
        )}
        <UserProvider user={userContext}>
          <LayoutShell>{children}</LayoutShell>
        </UserProvider>
      </body>
    </html>
  )
}
