import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSupplyCatalog } from '@/lib/db/supply-requests'

// GET /api/supply-catalog — active quick-pick supply list for the tech request
// form. Any authenticated user may read it. (Round 3 adds manager write methods.)
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const catalog = await getSupplyCatalog()
    return NextResponse.json({ catalog })
  } catch (err) {
    console.error('supply-catalog GET error:', err)
    return NextResponse.json({ error: 'Failed to load supplies.' }, { status: 500 })
  }
}
