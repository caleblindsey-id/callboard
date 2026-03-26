import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import LayoutShell from '@/components/LayoutShell'
import { UserProvider } from '@/components/UserProvider'
import { getCurrentUser } from '@/lib/auth'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'PM Scheduler',
  description: 'Preventive maintenance scheduling and tracking',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const dbUser = await getCurrentUser()

  // Refresh the pm-role cookie on every full page load
  if (dbUser?.role) {
    try {
      const cookieStore = await cookies()
      cookieStore.set('pm-role', dbUser.role, {
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
        <UserProvider user={userContext}>
          <LayoutShell>{children}</LayoutShell>
        </UserProvider>
      </body>
    </html>
  )
}
