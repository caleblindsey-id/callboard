'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  equipmentId: string
  make: string | null
  model: string | null
  serial: string | null
  /** Called after the unit is successfully verified. */
  onVerified: () => void
  onCancel?: () => void
}

const inputClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50'
const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

/**
 * Tech-facing panel to enter (if missing) or verify (if present) a unit's
 * make/model/serial before completing a ticket. Posts to
 * /api/equipment/[id]/verify, which stamps details_verified_at so completion
 * stops prompting for this unit. Used by both service and PM completion flows.
 */
export default function VerifyEquipmentPanel({
  equipmentId,
  make: initialMake,
  model: initialModel,
  serial: initialSerial,
  onVerified,
  onCancel,
}: Props) {
  const [make, setMake] = useState(initialMake ?? '')
  const [model, setModel] = useState(initialModel ?? '')
  const [serial, setSerial] = useState(initialSerial ?? '')
  const [noSerial, setNoSerial] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)

  async function handleVerify() {
    setError(null)
    setConflictId(null)

    if (!make.trim() || !model.trim()) {
      setError('Make and model are required.')
      return
    }
    if (!noSerial && !serial.trim()) {
      setError("Enter the serial number, or check “No serial / not legible”.")
      return
    }
    if (!confirmed) {
      setError('Please confirm these details match the unit.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/equipment/${equipmentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make: make.trim(),
          model: model.trim(),
          // noSerial → send blank so the endpoint stores NULL (never a sentinel).
          serial_number: noSerial ? '' : serial.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409) {
        setConflictId(data.existing_id ?? null)
        setError(data.error ?? 'Another unit already has that serial number.')
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to verify equipment.')
        setLoading(false)
        return
      }

      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Verify equipment details
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-300/80 mt-0.5">
          Confirm the make, model, and serial against the unit before completing.
        </p>
      </div>

      {error && (
        <div className="space-y-1">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          {conflictId && (
            <Link
              href={`/equipment/${conflictId}`}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              View the existing unit
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Make *</label>
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            className={inputClass}
            placeholder="e.g. Tennant"
          />
        </div>
        <div>
          <label className={labelClass}>Model *</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={inputClass}
            placeholder="e.g. T7AMR"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Serial Number</label>
        <input
          type="text"
          value={noSerial ? '' : serial}
          onChange={(e) => {
            setSerial(e.target.value)
            setConflictId(null)
          }}
          disabled={noSerial}
          className={inputClass}
          placeholder="e.g. 12345"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 min-h-[44px]">
          <input
            type="checkbox"
            checked={noSerial}
            onChange={(e) => {
              setNoSerial(e.target.checked)
              setError(null)
              setConflictId(null)
            }}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600"
          />
          No serial / not legible
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 min-h-[44px]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
        />
        These details match the unit.
      </label>

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleVerify}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-md disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Saving…' : 'Verify & Save'}
        </button>
      </div>
    </div>
  )
}
