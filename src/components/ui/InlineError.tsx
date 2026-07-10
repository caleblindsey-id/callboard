export interface InlineErrorProps {
  message: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Persistent, in-context error banner — pinned directly above/at the action
 * that failed (a form section, a failed fetch zone), NOT a toast. Use this for
 * anything the user needs to still see after the failure (a blocked save, a
 * silent-fetch-turned-visible error); use `Toast` only for a transient
 * success confirmation. Extracted from the `bg-red-50` banner already
 * dominant across ~30 files (see CallBoard Page Shell Standard).
 */
export default function InlineError({ message, onRetry, retryLabel = 'Retry', className = '' }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-md px-4 py-3 text-sm ${className}`.trim()}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium underline hover:no-underline"
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}
