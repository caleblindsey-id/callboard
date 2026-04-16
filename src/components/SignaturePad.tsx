'use client'

import { useRef, useEffect, useState } from 'react'
import SignaturePadLib from 'signature_pad'

interface SignaturePadProps {
  onSignatureChange: (data: { image: string | null; name: string }) => void
  initialName?: string
}

export default function SignaturePad({ onSignatureChange, initialName = '' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePadLib | null>(null)
  const [name, setName] = useState(initialName)
  const nameRef = useRef(initialName)
  const [hasSigned, setHasSigned] = useState(false)

  useEffect(() => {
    nameRef.current = name
  }, [name])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const pad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(0, 0, 0)',
    })

    pad.addEventListener('endStroke', () => {
      setHasSigned(!pad.isEmpty())
      onSignatureChange({
        image: pad.isEmpty() ? null : pad.toDataURL('image/png'),
        name: nameRef.current,
      })
    })

    padRef.current = pad

    function resizeCanvas() {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas!.getBoundingClientRect()
      canvas!.width = rect.width * ratio
      canvas!.height = rect.height * ratio
      const ctx = canvas!.getContext('2d')
      ctx?.scale(ratio, ratio)
      pad.clear()
      setHasSigned(false)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      pad.off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep parent in sync when name changes
  useEffect(() => {
    const pad = padRef.current
    onSignatureChange({
      image: pad && !pad.isEmpty() ? pad.toDataURL('image/png') : null,
      name,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  function handleClear() {
    padRef.current?.clear()
    setHasSigned(false)
    onSignatureChange({ image: null, name })
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">
            Customer Signature <span className="text-red-500">*</span>
          </label>
          {hasSigned && (
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-gray-500 hover:text-red-500 py-2 px-3 min-h-[44px] sm:min-h-0 sm:py-1 sm:px-2 flex items-center"
            >
              Clear
            </button>
          )}
        </div>
        <div className="border border-gray-300 rounded-md bg-white overflow-hidden touch-none">
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: 150 }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">Sign above with finger or stylus</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Printed Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="Customer's full name"
        />
      </div>
    </div>
  )
}
