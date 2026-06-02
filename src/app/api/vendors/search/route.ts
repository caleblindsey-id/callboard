import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'

export async function GET(request: NextRequest) {
  try {
    // Any authenticated role. Techs need this for the Synergy vendor picker on
    // the service-ticket "Request Part" form; the response is only vendor
    // name + code (not sensitive), so there's no manager-only data to protect.
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const q = sanitizeOrValue(request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 64)
    if (!q) {
      return NextResponse.json({ results: [] })
    }

    const supabase = await createClient()

    // Numeric q: also match exact vendor code (the int PK).
    const numeric = /^\d+$/.test(q)
    const filter = numeric
      ? safeOrRaw([
          { column: 'name', op: 'ilike', raw: `%${q}%` },
          { column: 'code', op: 'eq', raw: String(Number(q)) },
        ])
      : safeOrRaw([{ column: 'name', op: 'ilike', raw: `%${q}%` }])

    const { data, error } = await supabase
      .from('vendors')
      .select('code, name')
      .or(filter)
      .order('name')
      .limit(10)

    if (error) {
      console.error('vendors/search query error:', error)
      return NextResponse.json({ error: 'Search failed' }, { status: 500 })
    }

    return NextResponse.json({ results: data ?? [] })
  } catch (err) {
    console.error('vendors/search GET error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
