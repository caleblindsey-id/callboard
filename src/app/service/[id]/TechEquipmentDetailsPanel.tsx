'use client'

import { useState } from 'react'

interface Props {
  ticketId: string
  make: string | null
  model: string | null
  serial: string | null
  /** Called after the ticket's equipment details are successfully saved. */
  onSaved: () => void
}

const inputClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50'
const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

/**
 * Tech-facing panel to enter/verify the make/model/serial on an INLINE-ONLY
 * service ticket (one with no linked equipment row). The linked-equipment flow
 * uses VerifyEquipmentPanel, which stamps details_verified_at on the equipment
 * row; an inline ticket has no row to stamp, so this writes the denormalized
 * equipment_make/model/serial straight onto the ticket via PATCH. Once all
 * three are present the part-request gate (equipmentReadyForParts) clears.
 *
 * Serial is required here, matching the inline branch of equipmentReadyForParts
 * (an inline ticket has no verified-blank affirmation, unlike a linked unit).
 */
export default function TechEquipmentDetailsPanel({
  ticketId,
  make: initialMake,
  model: initialModel,
  serial: initialSerial,
  onSaved,
}: Props) {
  const [make, setMake] = useState(initialMake ?? '')
  const [model, setModel] = useState(initialModel ?? '')
  const [serial, setSerial] = useState(initialSerial ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)

    if (!make.trim() || !model.trim()) {
      setError('Make and model are required.')
      return
    }
    if (!serial.trim()) {
      setError('Enter the serial number from the unit.')
      return
    }
    if (!confirmed) {
      setError('Please confirm these details match the unit.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_make: make.trim(),
          equipment_model: model.trim(),
          equipment_serial_number: serial.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to save equipment details.')
        setLoading(false)
        return
      }
      onSaved()
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
          Confirm the make, model, and serial against the unit so the office
          knows what the parts are for.
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
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
        <label className={labelClass}>Serial Number *</label>
        <input
          type="text"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          className={inputClass}
          placeholder="e.g. 12345"
        />
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

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-md disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Saving…' : 'Save Equipment Details'}
        </button>
      </div>
    </div>
  )
}
