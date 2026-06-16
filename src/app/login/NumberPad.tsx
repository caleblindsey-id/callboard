'use client'

import { Delete } from 'lucide-react'

export const PIN_MIN = 4
export const PIN_MAX = 6

type Props = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** number of dot slots to render (defaults to PIN_MAX) */
  slots?: number
}

// Masked dot display + 0-9 / backspace pad. Shared by the login PIN entry and
// the enrollment prompt so both feel identical and no keyboard is needed.
export default function NumberPad({ value, onChange, disabled, slots = PIN_MAX }: Props) {
  function press(digit: string) {
    if (disabled) return
    if (value.length >= PIN_MAX) return
    onChange(value + digit)
  }
  function backspace() {
    if (disabled) return
    onChange(value.slice(0, -1))
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3 mb-5 h-4">
        {Array.from({ length: slots }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full transition-colors ${
              i < value.length ? 'bg-slate-800 dark:bg-slate-200' : 'bg-gray-200 dark:bg-gray-600'
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={disabled}
            className="h-16 w-16 rounded-full text-xl font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-95 disabled:opacity-50 transition"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => press('0')}
          disabled={disabled}
          className="h-16 w-16 rounded-full text-xl font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-95 disabled:opacity-50 transition"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled || value.length === 0}
          aria-label="Backspace"
          className="h-16 w-16 rounded-full flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 disabled:opacity-30 transition"
        >
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  )
}
