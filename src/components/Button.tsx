import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'mobile' | 'normal'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 disabled:bg-slate-400 dark:disabled:bg-slate-800',
  secondary:
    'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 disabled:text-gray-400 dark:disabled:text-gray-500',
  ghost:
    'bg-transparent hover:bg-gray-100 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-600',
  danger:
    'bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-600 disabled:bg-red-300 dark:disabled:bg-red-900',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  mobile:
    'min-h-[44px] lg:min-h-0 px-4 py-2 text-base lg:text-sm lg:py-1.5',
  normal: 'px-3 py-1.5 text-sm',
}

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap'

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'normal', className = '', type, children, ...rest },
  ref
) {
  const composed = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`.trim()
  return (
    <button ref={ref} type={type ?? 'button'} className={composed} {...rest}>
      {children}
    </button>
  )
})

export default Button
