import type { Metadata } from 'next'
import { cookies } from 'next/headers'
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
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const dbUser = await getCurrentUser()

  // Refresh auth cookies on every full page load
  if (dbUser?.role) {
    try {
      const cookieStore = await cookies()
      cookieStore.set('pm-role', dbUser.role, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
      cookieStore.set('pm-must-change-pw', dbUser.must_change_password ? 'true' : 'false', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
    } catch {
      // Cookie setting can fail in certain server component contexts — non-fatal
    }
  }

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
