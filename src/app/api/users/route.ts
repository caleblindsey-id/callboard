import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCurrentUser, ADMIN_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendUserInviteEmail } from '@/lib/users/send-invite-email'
import { UserRole } from '@/types/database'

const ALLOWED_ROLES: readonly UserRole[] = ['super_admin', 'manager', 'coordinator', 'technician'] as const

// Generate a random temp password that satisfies typical complexity rules
// (≥1 lowercase, ≥1 uppercase, ≥1 digit, ≥1 symbol). Generated server-side
// per-user — never embedded in the client bundle. The user is forced to
// change it on first login (must_change_password=true).
function generateTempPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz' // exclude i,l,o for readability
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = chars + upper + digits + symbols
  // 12 chars, guaranteed at least one of each class.
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[randomBytes(1)[0] % s.length]).join('')
  const required = pick(chars, 1) + pick(upper, 1) + pick(digits, 1) + pick(symbols, 1)
  const filler = pick(all, 8)
  // Shuffle deterministically using Fisher-Yates with crypto bytes.
  const arr = (required + filler).split('')
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.join('')
}

export async function POST(request: NextRequest) {
  let createdAuthUserId: string | null = null
  // Hoisted so the catch block can use it for rollback; assigned only after
  // the role check passes (the wrapper itself also re-validates ADMIN_ONLY).
  let admin: Awaited<ReturnType<typeof createAdminClient>> | null = null

  try {
    const currentUser = await getCurrentUser()
    if (!currentUser?.role || !ADMIN_ROLES.includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    admin = await createAdminClient('ADMIN_ONLY')

    const body = await request.json() as { name?: string; email?: string; role?: UserRole }
    const { name, email, role } = body
    if (!name || !email || !role) {
      return NextResponse.json({ error: 'name, email, and role are required' }, { status: 400 })
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
    }

    const tempPassword = generateTempPassword()
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    createdAuthUserId = authData.user.id

    const supabase = await createClient()
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        name,
        role,
        active: true,
        must_change_password: true,
        created_by_id: currentUser.id,
        updated_by_id: currentUser.id,
      })
      .select()
      .single()

    if (insertError) {
      // admin is non-null here — we set it above before any error path.
      await admin!.auth.admin.deleteUser(authData.user.id)
      createdAuthUserId = null
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Email the new user a single-use set-password link. Non-fatal: the user is
    // already created, and the temp password below is the break-glass fallback if
    // the send fails. inviteSent tells the UI which message to show.
    let inviteSent = false
    try {
      await sendUserInviteEmail({ email: user.email, name: user.name })
      inviteSent = true
    } catch (inviteErr) {
      console.error('POST /api/users: invite email failed (user created)', inviteErr)
    }

    return NextResponse.json(
      {
        id: user.id, name: user.name, email: user.email, role: user.role, active: user.active,
        // Whether the set-password invite email went out. When false, the admin
        // shares the temp password (or hits Resend invite) instead.
        inviteSent,
        // Temp password returned exactly once as a break-glass fallback. Forced
        // change on first login.
        tempPassword,
      },
      { status: 201 }
    )
  } catch (err) {
    if (createdAuthUserId && admin) {
      try {
        await admin.auth.admin.deleteUser(createdAuthUserId)
      } catch (rollbackErr) {
        console.error('Failed to roll back auth user after error:', rollbackErr)
      }
    }
    console.error('POST /api/users error:', err)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
