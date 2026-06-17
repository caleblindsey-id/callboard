'use client'

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { APP_NAME } from '@/lib/branding'
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
  Award,
  ScrollText,
  ShieldAlert,
  HelpCircle,
  PackageCheck,
  FileClock,
  FileX,
  ShieldCheck,
  Bell,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/components/UserProvider'
import NotificationBell from '@/components/notifications/NotificationBell'

type NavItem = { label: string; icon: LucideIcon; route: string }
type NavGroup = { key: string; label: string; items: NavItem[] }

// Dashboard stays pinned at the top, outside any collapsible group.
const dashboardItem: NavItem = { label: 'Dashboard', icon: LayoutDashboard, route: '/' }

// Office roles (manager / coordinator / super_admin) see these grouped sections.
const officeGroups: NavGroup[] = [
  {
    key: 'work',
    label: 'Work',
    items: [
      { label: 'Preventive Maintenance', icon: ClipboardList, route: '/tickets' },
      { label: 'Service Tickets', icon: Headset, route: '/service' },
    ],
  },
  {
    key: 'queues',
    label: 'Queues',
    items: [
      { label: 'Estimate Follow-Up', icon: FileClock, route: '/estimate-queue' },
      { label: 'Declined Estimates', icon: FileX, route: '/declined-queue' },
      { label: 'Warranty Claims', icon: ShieldCheck, route: '/warranty-queue' },
      { label: 'Credit Review', icon: ShieldAlert, route: '/credit-review' },
      { label: 'Parts Queue', icon: PackageSearch, route: '/parts-queue' },
      { label: 'Ready for Pickup', icon: PackageCheck, route: '/pickup-queue' },
    ],
  },
  {
    key: 'records',
    label: 'Records',
    items: [
      { label: 'Equipment', icon: Wrench, route: '/equipment' },
      { label: 'Customers', icon: Building2, route: '/customers' },
      { label: 'Products', icon: Package, route: '/products' },
      { label: 'Prospects', icon: UserRoundSearch, route: '/prospects' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    items: [
      { label: 'Billing', icon: FileText, route: '/billing' },
      { label: 'Tech Payouts', icon: Award, route: '/tech-payouts' },
      { label: 'Analytics', icon: BarChart3, route: '/analytics' },
    ],
  },
]

// Super-admin-only group, appended after the office groups.
const adminGroup: NavGroup = {
  key: 'admin',
  label: 'Admin',
  items: [
    { label: 'Settings', icon: Settings, route: '/settings' },
    { label: 'Audit Log', icon: ScrollText, route: '/admin/audit-log' },
  ],
}

// Technicians keep a flat menu — it's already short.
const techNavItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, route: '/' },
  { label: 'My PMs', icon: ClipboardList, route: '/tickets' },
  { label: 'Service Tickets', icon: Headset, route: '/service' },
  { label: 'My Parts', icon: PackageCheck, route: '/my-parts' },
  { label: 'Equipment', icon: Wrench, route: '/my-equipment' },
  { label: 'My Leads', icon: Award, route: '/my-leads' },
  { label: 'Products', icon: Package, route: '/products' },
]

// First-load defaults; per-user choices are layered on top from localStorage.
const DEFAULT_OPEN: Record<string, boolean> = {
  work: true,
  queues: true,
  records: false,
  money: false,
  admin: false,
}
const STORAGE_KEY = 'callboard:navGroups'

// Tiny external store over localStorage so group open/closed state survives
// reloads. useSyncExternalStore keeps this SSR-safe (server snapshot = null →
// defaults, then React re-reads on the client) and avoids the
// set-state-in-effect pattern. Same-tab writes notify via listeners; other
// tabs sync through the native 'storage' event.
const navGroupStore = {
  listeners: new Set<() => void>(),
  getSnapshot(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  },
  set(value: Record<string, boolean>) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // ignore unavailable storage
    }
    navGroupStore.listeners.forEach((l) => l())
  },
  subscribe(listener: () => void): () => void {
    navGroupStore.listeners.add(listener)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) listener()
    }
    try {
      window.addEventListener('storage', onStorage)
    } catch {
      // ignore
    }
    return () => {
      navGroupStore.listeners.delete(listener)
      try {
        window.removeEventListener('storage', onStorage)
      } catch {
        // ignore
      }
    }
  },
}

function isRouteActive(route: string, pathname: string): boolean {
  return route === '/' ? pathname === '/' : pathname.startsWith(route)
}

function NavLink({
  item,
  pathname,
  onClose,
}: {
  item: NavItem
  pathname: string
  onClose: () => void
}) {
  const isActive = isRouteActive(item.route, pathname)
  const Icon = item.icon
  return (
    <Link
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
}

function NavGroupSection({
  group,
  pathname,
  open,
  onToggle,
  onClose,
}: {
  group: NavGroup
  pathname: string
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  // The group holding the current page always renders open so you never lose
  // sight of where you are, even if you'd collapsed it.
  const hasActive = group.items.some((i) => isRouteActive(i.route, pathname))
  const expanded = open || hasActive
  const panelId = `nav-group-${group.key}`
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300 transition-colors"
      >
        <span>{group.label}</span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div id={panelId} className="mt-0.5 space-y-1">
          {group.items.map((item) => (
            <NavLink key={item.route} item={item} pathname={pathname} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useUser()

  const isTech = user?.role === 'technician'

  // Office groups; super_admin also gets the Admin group. Memoized so the array
  // (and the super_admin spread) isn't rebuilt on every UserProvider re-render.
  const groups = useMemo(() => {
    if (isTech) return []
    return user?.role === 'super_admin' ? [...officeGroups, adminGroup] : officeGroups
  }, [isTech, user?.role])

  // Persisted open/closed prefs, layered over the first-load defaults. Server
  // snapshot is null → defaults render on the server and first client paint,
  // so there's no hydration mismatch; React then re-reads localStorage.
  const storedRaw = useSyncExternalStore(
    navGroupStore.subscribe,
    navGroupStore.getSnapshot,
    () => null,
  )
  const openGroups = useMemo<Record<string, boolean>>(() => {
    if (!storedRaw) return DEFAULT_OPEN
    try {
      return { ...DEFAULT_OPEN, ...(JSON.parse(storedRaw) as Record<string, boolean>) }
    } catch {
      return DEFAULT_OPEN
    }
  }, [storedRaw])

  function toggleGroup(key: string) {
    navGroupStore.set({ ...openGroups, [key]: !(openGroups[key] ?? false) })
  }

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
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <Wrench className="h-5 w-5 text-gray-300" />
              <span className="text-base font-semibold text-white tracking-tight">
                {APP_NAME}
              </span>
            </div>
            <NotificationBell />
          </div>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-1">
          {isTech ? (
            techNavItems.map((item) => (
              <NavLink key={item.route} item={item} pathname={pathname} onClose={onClose} />
            ))
          ) : (
            <>
              <NavLink item={dashboardItem} pathname={pathname} onClose={onClose} />
              {groups.map((group) => (
                <div key={group.key} className="pt-2">
                  <NavGroupSection
                    group={group}
                    pathname={pathname}
                    open={openGroups[group.key] ?? DEFAULT_OPEN[group.key] ?? false}
                    onToggle={() => toggleGroup(group.key)}
                    onClose={onClose}
                  />
                </div>
              ))}
            </>
          )}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800 space-y-1">
          <Link
            href="/help"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <HelpCircle className="h-4 w-4 shrink-0" />
            Help &amp; Guides
          </Link>
          <Link
            href="/notifications"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <Bell className="h-4 w-4 shrink-0" />
            Notifications
          </Link>
          <Link
            href="/account"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Account Security
          </Link>
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
