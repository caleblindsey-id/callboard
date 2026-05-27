import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { UserRole } from '@/types/database'

// User-manual content. Authored as markdown files under src/content/help, one
// file per guide. Read at request time (the /help route is dynamic because it
// checks auth) — the files ship in the serverless bundle via
// outputFileTracingIncludes in next.config.ts. No caching: the file set is
// tiny and always-fresh reads make authoring painless in `next dev`.
const HELP_ROOT = path.join(process.cwd(), 'src/content/help')

const ALL_ROLES: UserRole[] = ['super_admin', 'manager', 'coordinator', 'technician']

export interface HelpPage {
  slug: string[] // ['overview', 'what-is-callboard']
  href: string // /help/overview/what-is-callboard
  title: string
  category: string
  roles: UserRole[]
  order: number
  summary: string
  lastVerified: string | null
  body: string // markdown body, frontmatter stripped
}

export interface HelpNavGroup {
  category: string
  pages: Pick<HelpPage, 'href' | 'title' | 'summary'>[]
}

// Display order of categories in the nav and on the landing page. Anything not
// listed falls to the end.
export const CATEGORY_ORDER = ['Overview', 'Technicians', 'Office', 'Managers', 'Admin', 'Reference']

// The nav section to auto-expand for each role, beyond Overview.
export const ROLE_HOME_CATEGORY: Record<UserRole, string> = {
  technician: 'Technicians',
  coordinator: 'Office',
  manager: 'Managers',
  super_admin: 'Admin',
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category)
  return i === -1 ? CATEGORY_ORDER.length : i
}

function normalizeLastVerified(value: unknown): string | null {
  if (!value) return null
  // gray-matter parses bare YAML dates (2026-05-27) into Date objects.
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

export function getAllHelpPages(): HelpPage[] {
  if (!fs.existsSync(HELP_ROOT)) return []

  const files = fs
    .readdirSync(HELP_ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.md'))

  const pages: HelpPage[] = files.map((rel) => {
    const raw = fs.readFileSync(path.join(HELP_ROOT, rel), 'utf8')
    const { data, content } = matter(raw)
    const slug = rel.replace(/\\/g, '/').replace(/\.md$/, '').split('/')
    const roles = Array.isArray(data.roles) && data.roles.length > 0 ? (data.roles as UserRole[]) : ALL_ROLES
    return {
      slug,
      href: '/help/' + slug.join('/'),
      title: typeof data.title === 'string' ? data.title : slug[slug.length - 1],
      category: typeof data.category === 'string' ? data.category : 'Reference',
      roles,
      order: typeof data.order === 'number' ? data.order : 999,
      summary: typeof data.summary === 'string' ? data.summary : '',
      lastVerified: normalizeLastVerified(data.last_verified),
      body: content,
    }
  })

  pages.sort((a, b) => {
    const c = categoryRank(a.category) - categoryRank(b.category)
    if (c !== 0) return c
    if (a.order !== b.order) return a.order - b.order
    return a.title.localeCompare(b.title)
  })

  return pages
}

export function getHelpPage(slug: string[]): HelpPage | null {
  const target = slug.join('/')
  return getAllHelpPages().find((p) => p.slug.join('/') === target) ?? null
}

export function getHelpNav(): HelpNavGroup[] {
  const groups: HelpNavGroup[] = []
  for (const page of getAllHelpPages()) {
    let group = groups.find((g) => g.category === page.category)
    if (!group) {
      group = { category: page.category, pages: [] }
      groups.push(group)
    }
    group.pages.push({ href: page.href, title: page.title, summary: page.summary })
  }
  return groups
}
