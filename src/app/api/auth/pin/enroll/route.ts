import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPin, pinPolicyError } from '@/lib/pin'

// Set or replace this device's quick-PIN for the CURRENTLY logged-in tech. Runs
// under the tech's live session (they just did a full email+password login), so
// the user_id is taken from the validated session, never the request body.
export async function POST(request: NextRequest) {
  try {
    const { device_id, pin, label } = (await request.json()) as {
      device_id?: string
      pin?: string
      label?: string
    }

    if (!device_id || typeof device_id !== 'string') {
      return NextResponse.json({ error: 'Missing device id.' }, { status: 400 })
    }
    if (!pin || typeof pin !== 'string') {
      return NextResponse.json({ error: 'Missing PIN.' }, { status: 400 })
    }
    const policyError = pinPolicyError(pin)
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.' }, { status: 401 })
    }

    const admin = await createAdminClient('SERVER_ONLY')

    // Only an active user who isn't mid forced-password-change may enroll a PIN.
    const { data: row, error: rowError } = await admin
      .from('users')
      .select('active, must_change_password')
      .eq('id', user.id)
      .single()
    if (rowError || !row) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }
    if (!row.active) {
      return NextResponse.json({ error: 'Account is inactive.' }, { status: 403 })
    }
    if (row.must_change_password) {
      return NextResponse.json({ error: 'Finish changing your password before setting a PIN.' }, { status: 403 })
    }

    const pin_hash = await hashPin(pin)

    // Upsert on (device_id, user_id): re-enrolling on the same device replaces the
    // PIN and clears any prior lockout.
    const { error: upsertError } = await admin
      .from('device_pins')
      .upsert(
        {
          user_id: user.id,
          device_id,
          pin_hash,
          label: label?.slice(0, 80) ?? null,
          failed_attempts: 0,
          locked_until: null,
        },
        { onConflict: 'device_id,user_id' }
      )
    if (upsertError) {
      console.error('PIN enroll upsert failed:', upsertError)
      return NextResponse.json({ error: 'Could not save your PIN. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/auth/pin/enroll error:', err)
    return NextResponse.json({ error: 'Could not save your PIN.' }, { status: 500 })
  }
}
