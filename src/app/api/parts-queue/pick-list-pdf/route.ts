export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { PickListDocument, type PickListRow } from '@/lib/pdf/pick-list-template'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import * as fs from 'fs'
import * as path from 'path'

// Office/manager-only — same gate as /api/parts-queue/update. Renders the
// To-Pull pick list (rows posted from the client, already filtered to the tab)
// as a printable PDF. Server-side @react-pdf render, Vercel-nodejs-safe.
const MAX_ROWS = 2000

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as { rows?: unknown }
    if (!Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
    }
    const rows = (body.rows as PickListRow[]).slice(0, MAX_ROWS)

    // Load logo (optional — render without it if missing).
    let logoBase64: string | null = null
    try {
      const logoPath = path.join(process.cwd(), 'public', 'imperial-dade-logo.png')
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    } catch {
      // no logo — fine
    }

    const generatedDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const element = React.createElement(PickListDocument, { rows, generatedDate, logoBase64 })

    let buffer: Buffer
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buffer = await renderToBuffer(element as React.ReactElement<any>)
    } catch (renderErr) {
      console.error('[pick-list-pdf] renderToBuffer error:', renderErr)
      return NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
    }

    const filename = `pick-list-${new Date().toISOString().slice(0, 10)}.pdf`
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[pick-list-pdf] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
