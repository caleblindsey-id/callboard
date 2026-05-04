import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth'
import { getSetting, setSetting } from '@/lib/db/settings'

// Allowlist of settings keys staff can read/write through this endpoint.
// Any future setting must be added here explicitly.
const ALLOWED_KEYS = new Set([
  'labor_rate_per_hour',
  'industrial_labor_rate_per_hour',
  'vacuum_labor_rate_per_hour',
  'company_name',
  'service_email',
  'service_phone',
])

const NUMERIC_RATE_KEYS = new Set([
  'labor_rate_per_hour',
  'industrial_labor_rate_per_hour',
  'vacuum_labor_rate_per_hour',
])

const VALUE_MAX_LEN = 500

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    // Manager+ only — techs don't need to read settings, and labor_rate +
    // branding values can be inferred for cost-of-service if exposed.
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const key = request.nextUrl.searchParams.get('key')
    if (!key) {
      return NextResponse.json({ error: 'key parameter is required' }, { status: 400 })
    }
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: 'Unknown setting key' }, { status: 400 })
    }

    const value = await getSetting(key)
    return NextResponse.json({ key, value })
  } catch (err) {
    console.error('settings GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch setting' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { key, value } = await request.json() as { key: string; value: string }
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
    }
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: 'Unknown setting key' }, { status: 400 })
    }
    if (typeof value !== 'string' || value.length > VALUE_MAX_LEN) {
      return NextResponse.json({ error: 'value must be a string under 500 chars' }, { status: 400 })
    }

    // Labor rate keys must be non-negative numbers
    if (NUMERIC_RATE_KEYS.has(key)) {
      const n = parseFloat(value)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 })
      }
    }

    await setSetting(key, value)
    return NextResponse.json({ key, value })
  } catch (err) {
    console.error('settings PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }
}
