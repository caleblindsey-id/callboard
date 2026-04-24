'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, Wrench } from 'lucide-react'
import Sidebar from './Sidebar'
import { APP_NAME } from '@/lib/branding'

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/forgot-password' || pathname === '/change-password') {
    return <>{children}</>
  }

  return (
    <>
      {/* Mobile-only top header bar */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-gray-900 flex items-center px-4 z-20 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-gray-400 hover:text-white"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-gray-300" />
          <span className="text-sm font-semibold text-white tracking-tight">
            {APP_NAME}
          </span>
        </div>
      </header>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Content — full-width on mobile, offset by sidebar on desktop */}
      <main className="lg:ml-60 min-h-full pt-14 lg:pt-0">
        {children}
      </main>
    </>
  )
}
