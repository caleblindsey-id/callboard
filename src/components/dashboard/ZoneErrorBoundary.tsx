'use client'

import { Component, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

interface ZoneErrorBoundaryInnerProps {
  children: ReactNode
  onRetry: () => void
}

interface ZoneErrorBoundaryState {
  hasError: boolean
}

// Class component defined at module level (not inside the exported function
// below) per the no-inner-components rule. React error boundaries must be
// class components; useRouter() is a hook, so it's read in the thin function
// wrapper and passed down as a prop instead.
class ZoneErrorBoundaryInner extends Component<ZoneErrorBoundaryInnerProps, ZoneErrorBoundaryState> {
  state: ZoneErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('dashboard zone error boundary:', error)
  }

  // The failed fetch lives inside a Server Component that already resolved
  // (or rejected) as part of this page's RSC payload — there's no local
  // promise to re-run. router.refresh() is the only way to ask Next.js for a
  // fresh payload; clearing hasError lets this zone render normally the
  // moment that payload lands, while zones that already succeeded are
  // unaffected.
  handleRetry = () => {
    this.setState({ hasError: false })
    this.props.onRetry()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-400">
          <p className="mb-2">This section failed to load.</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="text-sm text-slate-700 dark:text-slate-300 underline"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Wraps one dashboard Suspense zone (src/app/page.tsx) so a single failed
// fetch degrades that zone only, not the whole page.
export default function ZoneErrorBoundary({ children }: { children: ReactNode }) {
  const router = useRouter()
  return <ZoneErrorBoundaryInner onRetry={() => router.refresh()}>{children}</ZoneErrorBoundaryInner>
}
