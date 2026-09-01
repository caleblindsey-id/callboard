import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth'
import { getSetting, setSetting } from '@/lib/db/settings'
import { parseEmailList } from '@/lib/credit-review-crypto'

// Allowlist of settings keys staff can read/write through this endpoint.
// Any future setting must be added here explicitly.
// NOTE: credit_hold_release_passcode_hash is deliberately NOT here — it is
// write-only via /api/settings/credit-passcode and must never be returned.
const ALLOWED_KEYS = new Set([
  'labor_rate_per_hour',
  'industrial_labor_rate_per_hour',
  'vacuum_labor_rate_per_hour',
  'trip_charge_amount',
  'company_name',
  'service_email',
  'service_phone',
  'ar_email',
  'credit_followup_days',
  'manager_digest_to',
  'manager_digest_cc',
  'pickup_address',
  'pickup_hours',
])

const NUMERIC_RATE_KEYS = new Set([
  'labor_rate_per_hour',
  'industrial_labor_rate_per_hour',
  'vacuum_labor_rate_per_hour',
  'trip_charge_amount',
])

// Keys holding a comma/semicolon/whitespace-separated email list. A non-empty
// value must parse to at least one plausible address.
const EMAIL_LIST_KEYS = new Set(['ar_email', 'manager_digest_to', 'manager_digest_cc'])

// Whole-number keys with a hard range. credit_followup_days drives how often the
// credit-followup cron re-emails AR: 0 would mean a fresh email on every daily
// run, so the floor is enforced here as well as being clamped in
// parseFollowupDays() when the value is read.
const DAY_COUNT_KEYS = new Map<string, { min: number; max: number }>([
  ['credit_followup_days', { min: 1, max: 30 }],
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

    const dayRange = DAY_COUNT_KEYS.get(key)
    if (dayRange) {
      const n = Number(value.trim())
      if (!Number.isInteger(n) || n < dayRange.min || n > dayRange.max) {
        return NextResponse.json(
          { error: `${key} must be a whole number between ${dayRange.min} and ${dayRange.max}.` },
          { status: 400 }
        )
      }
    }

    // Email-list keys: empty clears the setting; otherwise it must contain at
    // least one plausible address.
    if (EMAIL_LIST_KEYS.has(key) && value.trim() !== '' && parseEmailList(value).length === 0) {
      return NextResponse.json(
        { error: `${key} must be one or more email addresses, separated by commas.` },
        { status: 400 }
      )
    }

    await setSetting(key, value)
    return NextResponse.json({ key, value })
  } catch (err) {
    console.error('settings PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }
}
