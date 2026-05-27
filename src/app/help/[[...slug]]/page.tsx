import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getHelpNav, getHelpPage, ROLE_HOME_CATEGORY } from '@/lib/help'
import HelpNav from './HelpNav'

export const metadata = {
  title: 'Help & Guides — CallBoard',
}

export default async function HelpPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const user = await requireRole(...MANAGER_ROLES, 'technician')
  const { slug } = await params

  const nav = getHelpNav()
  const homeCategory = user.role ? ROLE_HOME_CATEGORY[user.role] : undefined
  const defaultOpen = ['Overview', ...(homeCategory ? [homeCategory] : [])]

  const page = slug && slug.length > 0 ? getHelpPage(slug) : null
  if (slug && slug.length > 0 && !page) notFound()

  return (
    <div className="p-6">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 max-w-5xl">
        <HelpNav groups={nav} defaultOpen={defaultOpen} />

        <div className="mt-6 lg:mt-0 min-w-0">
          {page ? (
            <article>
              <Link
                href="/help"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                All guides
              </Link>
              <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">{page.title}</h1>
              {page.summary && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{page.summary}</p>
              )}
              <div className="prose prose-slate dark:prose-invert max-w-none mt-6 prose-headings:scroll-mt-20 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-table:text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}
                >
                  {page.body}
                </ReactMarkdown>
              </div>
              {page.lastVerified && (
                <p className="mt-10 pt-4 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500">
                  Last verified {page.lastVerified}
                </p>
              )}
            </article>
          ) : (
            <Landing nav={nav} homeCategory={homeCategory} />
          )}
        </div>
      </div>
    </div>
  )
}

function Landing({ nav, homeCategory }: { nav: ReturnType<typeof getHelpNav>; homeCategory?: string }) {
  const homeGroup = homeCategory ? nav.find((g) => g.category === homeCategory) : undefined
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Help &amp; Guides</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Step-by-step guides for everyday work in CallBoard.
        </p>
      </div>

      {homeGroup && homeGroup.pages.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-5">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide">Start here</h2>
          <ul className="mt-3 space-y-1.5">
            {homeGroup.pages.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="text-sm text-blue-700 dark:text-blue-300 hover:underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {nav.map((group) => (
          <section key={group.category}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {group.category}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {group.pages.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:underline"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
