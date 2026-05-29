import { NextResponse, type NextRequest } from 'next/server'
import Fuse from 'fuse.js'
import { getCurrentUser } from '@/lib/auth'
import { getAllHelpPages } from '@/lib/help'

// Server-side search over the help guides. The /help route is already dynamic
// (auth-gated), so searching on the server — rather than shipping a build-time
// index + Fuse to the client — keeps the dataset always-fresh and avoids a
// build step. The corpus is tiny (~30 short docs); building the index per
// request is negligible.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })

  const pages = getAllHelpPages()
  const fuse = new Fuse(pages, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'summary', weight: 0.3 },
      { name: 'body', weight: 0.2 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  })

  const results = fuse
    .search(q, { limit: 8 })
    .map(({ item }) => ({
      href: item.href,
      title: item.title,
      category: item.category,
      summary: item.summary,
    }))

  return NextResponse.json({ results })
}
