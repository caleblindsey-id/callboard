import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages technicians are allowed to access
const TECH_ALLOWED_PAGES = ['/', '/tickets', '/service', '/login', '/change-password', '/my-leads', '/my-equipment']
const TECH_ALLOWED_PAGE_PATTERNS = [
  /^\/tickets\/[^/]+$/,    // /tickets/[id]
  /^\/equipment\/[^/]+$/,  // /equipment/[id] — read-only for techs
  /^\/service\/[^/]+$/,    // /service/[id] — own assigned service tickets
]

// API routes technicians are allowed to access.
// IMPORTANT: patterns anchored with $ or trailing-slash to avoid matching flat
// sibling routes like /api/tickets/bulk-delete or /api/tickets/generate.
const TECH_ALLOWED_API_PATTERNS = [
  /^\/api\/auth\//,                                          // Self-service auth (change-password) — all roles
  /^\/api\/tickets\/[0-9a-f-]{36}(\/|$)/i,                   // PATCH /api/tickets/[uuid] and /api/tickets/[uuid]/complete
  /^\/api\/service-tickets(\/|$)/,                           // GET /api/service-tickets + /api/service-tickets/[id]/*
  /^\/api\/equipment\/[^/]+\/notes$/,                        // GET + POST /api/equipment/[id]/notes
  /^\/api\/tech-leads(\/|$)/,                                // POST /api/tech-leads (Submit Lead modal)
  /^\/api\/ship-to-requests(\/|$)/,                          // POST /api/ship-to-requests (request new ship-to)
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
  if (pathname.startsWith('/login') || pathname.startsWith('/forgot-password') || pathname.startsWith('/auth/') || pathname.startsWith('/approve') || pathname.startsWith('/api/approve')) {
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

  if (!role || mustChangePwFromCookie === undefined) {
    const { data: userData } = await supabase
      .from('users')
      .select('role, must_change_password')
      .eq('id', user.id)
      .single()

    if (userData) {
      role = userData.role
      mustChangePwFromCookie = userData.must_change_password ? 'true' : 'false'
      supabaseResponse.cookies.set('pm-role', role!, PM_COOKIE_OPTS)
      supabaseResponse.cookies.set('pm-must-change-pw', mustChangePwFromCookie!, PM_COOKIE_OPTS)
    }
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
