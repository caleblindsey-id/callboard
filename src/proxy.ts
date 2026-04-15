import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages technicians are allowed to access
const TECH_ALLOWED_PAGES = ['/', '/tickets', '/service', '/login', '/change-password']
const TECH_ALLOWED_PAGE_PATTERNS = [
  /^\/tickets\/[^/]+$/,    // /tickets/[id]
  /^\/equipment\/[^/]+$/,  // /equipment/[id] — read-only for techs
  /^\/service\/[^/]+$/,    // /service/[id] — own assigned service tickets
]

// API routes technicians are allowed to access
const TECH_ALLOWED_API_PATTERNS = [
  /^\/api\/tickets\/[^/]+/,              // PATCH /api/tickets/[id] and POST /api/tickets/[id]/complete
  /^\/api\/service-tickets(\/|$)/,       // GET /api/service-tickets + /api/service-tickets/[id]/*
  /^\/api\/equipment\/[^/]+\/notes$/,    // GET + POST /api/equipment/[id]/notes
]

function isTechAllowed(pathname: string): boolean {
  if (TECH_ALLOWED_PAGES.includes(pathname)) return true
  if (TECH_ALLOWED_PAGE_PATTERNS.some((p) => p.test(pathname))) return true
  if (TECH_ALLOWED_API_PATTERNS.some((p) => p.test(pathname))) return true
  return false
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

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Redirect unauthenticated users to login
  if (!session) {
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
  let role = request.cookies.get('pm-role')?.value
  let mustChangePwFromCookie = request.cookies.get('pm-must-change-pw')?.value

  if ((!role || mustChangePwFromCookie === undefined) && session) {
    const { data: userData } = await supabase
      .from('users')
      .select('role, must_change_password')
      .eq('id', session.user.id)
      .single()

    if (userData) {
      role = userData.role
      mustChangePwFromCookie = userData.must_change_password ? 'true' : 'false'
      const cookieOpts = { httpOnly: true, sameSite: 'strict' as const, path: '/' }
      supabaseResponse.cookies.set('pm-role', role!, cookieOpts)
      supabaseResponse.cookies.set('pm-must-change-pw', mustChangePwFromCookie!, cookieOpts)
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

  // Force password change if flagged
  if (
    mustChangePwFromCookie === 'true' &&
    !pathname.startsWith('/change-password') &&
    !pathname.startsWith('/auth/') &&
    !pathname.startsWith('/api/')
  ) {
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
