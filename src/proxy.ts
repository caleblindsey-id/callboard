import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages technicians are allowed to access
const TECH_ALLOWED_PAGES = ['/', '/tickets', '/service', '/service/new', '/login', '/change-password', '/account', '/notifications', '/my-leads', '/my-equipment', '/my-parts', '/my-supplies', '/products', '/help']
const TECH_ALLOWED_PAGE_PATTERNS = [
  /^\/tickets\/[^/]+$/,    // /tickets/[id]
  /^\/equipment\/[^/]+$/,  // /equipment/[id] — read-only for techs
  /^\/service\/[^/]+$/,    // /service/[id] — own assigned service tickets
  /^\/help(\/|$)/,         // /help and all guide pages — read-only docs, all roles
]

// API routes technicians are allowed to access.
// IMPORTANT: patterns anchored with $ or trailing-slash to avoid matching flat
// sibling routes like /api/tickets/bulk-delete or /api/tickets/generate.
const TECH_ALLOWED_API_PATTERNS = [
  /^\/api\/auth\//,                                          // Self-service auth (change-password) — all roles
  /^\/api\/tickets\/[0-9a-f-]{36}(\/|$)/i,                   // PATCH /api/tickets/[uuid] and /api/tickets/[uuid]/complete
  /^\/api\/service-tickets(\/|$)/,                           // GET /api/service-tickets + /api/service-tickets/[id]/*
  /^\/api\/equipment\/[^/]+\/notes$/,                        // GET + POST /api/equipment/[id]/notes
  /^\/api\/equipment\/[^/]+\/verify$/,                       // POST /api/equipment/[id]/verify (tech confirms make/model/serial at completion)
  /^\/api\/tech-leads(\/|$)/,                                // POST /api/tech-leads (Submit Lead modal)
  /^\/api\/ship-to-requests(\/|$)/,                          // POST /api/ship-to-requests (request new ship-to)
  /^\/api\/feedback$/,                                       // POST /api/feedback (FAB submission — all roles)
  /^\/api\/help\/search$/,                                   // GET /api/help/search (help center search — all roles)
  /^\/api\/ace-labor\/[0-9a-f-]{36}$/i,                      // PATCH /api/ace-labor/[uuid] (tech edits pending/rejected entry from ticket detail)
  /^\/api\/vendors\/search(\/|$)/,                           // GET /api/vendors/search (Synergy vendor picker on the Request Part form — all roles)
  /^\/api\/push\//,                                          // POST/DELETE /api/push/subscribe (tech opts into assignment push)
  /^\/api\/notifications(\/|$)/,                             // GET /api/notifications + POST /api/notifications/mark-read (the bell)
  /^\/api\/supply-requests(\/|$)/,                           // POST /api/supply-requests (tech requests supplies) + DELETE /api/supply-requests/[id] (cancel own); manager-only PATCH actions are role-gated in the route
  /^\/api\/supply-catalog(\/|$)/,                            // GET /api/supply-catalog (quick-pick list — all roles)
]

function isTechAllowed(pathname: string): boolean {
  if (TECH_ALLOWED_PAGES.includes(pathname)) return true
  if (TECH_ALLOWED_PAGE_PATTERNS.some((p) => p.test(pathname))) return true
  if (TECH_ALLOWED_API_PATTERNS.some((p) => p.test(pathname))) return true
  return false
}

const PM_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 300, // 5 minutes — bounds role/forced-change staleness across role demotions
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Skip auth check for public routes
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/forgot-password') || pathname.startsWith('/auth/') || pathname === '/api/auth/pin/login' || pathname.startsWith('/e/') || pathname.startsWith('/approve') || pathname.startsWith('/api/approve') || pathname.startsWith('/cr/') || pathname.startsWith('/api/credit-review/') || pathname.startsWith('/api/cron/') || pathname === '/sw.js' || pathname === '/manifest.webmanifest') {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Server-validated user (network call to Supabase Auth) — rejects revoked sessions.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Role-based access: read the pm-role cookie (set by layout.tsx on each page load).
  // On the first request after login the cookie doesn't exist yet — fall back to a
  // one-time DB lookup and set the cookies on the response so subsequent requests are fast.
  // The cookie has a 5-minute maxAge so role demotions take effect within that window.
  let role = request.cookies.get('pm-role')?.value
  let mustChangePwFromCookie = request.cookies.get('pm-must-change-pw')?.value

  // Set when the authenticated session has no usable profile row — an orphaned /
  // unprovisioned auth account, or a deactivated user. Such a session must be
  // denied, NOT allowed to fall through (it would otherwise render the full
  // manager dashboard, since role stays undefined and the tech gate is skipped).
  let deniedReason: 'not_provisioned' | 'deactivated' | null = null

  if (!role || mustChangePwFromCookie === undefined) {
    const { data: userData, error: lookupError } = await supabase
      .from('users')
      .select('role, must_change_password, active')
      .eq('id', user.id)
      .single()

    if (userData && userData.active !== false) {
      role = userData.role
      mustChangePwFromCookie = userData.must_change_password ? 'true' : 'false'
      supabaseResponse.cookies.set('pm-role', role!, PM_COOKIE_OPTS)
      supabaseResponse.cookies.set('pm-must-change-pw', mustChangePwFromCookie!, PM_COOKIE_OPTS)
    } else if (userData && userData.active === false) {
      deniedReason = 'deactivated'
    } else if ((lookupError as { code?: string } | null)?.code === 'PGRST116') {
      // PostgREST "no rows" from .single() — confirmed missing profile row.
      // (A transient DB error is intentionally NOT treated as denied, to avoid
      // logging out legitimate users during a blip.)
      deniedReason = 'not_provisioned'
    }
  }

  if (deniedReason) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Account not provisioned.' }, { status: 403 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', deniedReason)
    const denied = NextResponse.redirect(url)
    // Clear the dead session so it doesn't linger and re-trigger this on every hit.
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith('sb-')) denied.cookies.delete(cookie.name)
    }
    denied.cookies.delete('pm-role')
    denied.cookies.delete('pm-must-change-pw')
    return denied
  }

  if (role === 'technician') {
    if (!isTechAllowed(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  // Force password change if flagged. Only the auth API endpoints are exempt —
  // every other API and page is blocked until the password is changed.
  if (
    mustChangePwFromCookie === 'true' &&
    !pathname.startsWith('/change-password') &&
    !pathname.startsWith('/auth/') &&
    !pathname.startsWith('/api/auth/')
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Password change required.' }, { status: 403 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/change-password'
    url.searchParams.set('forced', 'true')
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
