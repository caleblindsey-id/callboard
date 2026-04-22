'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  Wrench,
  Headset,
  Building2,
  Package,
  PackageSearch,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  UserRoundSearch,
  KeyRound,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/components/UserProvider'

const allNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, route: '/' },
  { label: 'Preventive Maintenance', icon: ClipboardList, route: '/tickets' },
  { label: 'Service Tickets', icon: Headset, route: '/service' },
  { label: 'Parts Queue', icon: PackageSearch, route: '/parts-queue' },
  { label: 'Billing', icon: FileText, route: '/billing' },
  { label: 'Equipment', icon: Wrench, route: '/equipment' },
  { label: 'Prospects', icon: UserRoundSearch, route: '/prospects' },
  { label: 'Customers', icon: Building2, route: '/customers' },
  { label: 'Products', icon: Package, route: '/products' },
  { label: 'Analytics', icon: BarChart3, route: '/analytics' },
]

const adminNavItems = [
  { label: 'Settings', icon: Settings, route: '/settings' },
]

const techNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, route: '/' },
  { label: 'My PMs', icon: ClipboardList, route: '/tickets' },
  { label: 'Service Tickets', icon: Headset, route: '/service' },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useUser()
  const navItems = user?.role === 'technician'
    ? techNavItems
    : user?.role === 'super_admin'
      ? [...allNavItems, ...adminNavItems]
      : allNavItems

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile backdrop — hidden on desktop */}
      <div
        className={`fixed inset-0 bg-black/50 z-30 lg:hidden transition-opacity duration-200 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar panel — drawer on mobile, fixed on desktop */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 bg-gray-900 flex flex-col z-40 transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="px-5 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-gray-300" />
            <span className="text-base font-semibold text-white tracking-tight">
              PM Scheduler
            </span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.route === '/'
                ? pathname === '/'
                : pathname.startsWith(item.route)
            const Icon = item.icon

            return (
              <Link
                key={item.route}
                href={item.route}
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800 space-y-1">
          <Link
            href="/change-password"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            Change Password
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log Out
          </button>
        </div>
      </aside>
    </>
  )
}
