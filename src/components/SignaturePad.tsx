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
      const newWidth = Math.round(rect.width * ratio)
      const newHeight = Math.round(rect.height * ratio)

      // Skip resize events that don't actually change the canvas size
      // (mobile soft keyboard opening, address-bar show/hide on scroll).
      // Resizing a <canvas> wipes its bitmap, so a no-op resize must NOT
      // clear an in-progress signature — this is the bug techs hit.
      if (canvas!.width === newWidth && canvas!.height === newHeight) return

      // Genuine resize (e.g. orientation change): preserve the strokes,
      // resize, then replay them onto the new canvas.
      const data = pad.toData()
      canvas!.width = newWidth
      canvas!.height = newHeight
      canvas!.getContext('2d')?.scale(ratio, ratio)
      pad.clear()
      if (data.length) {
        pad.fromData(data)
        setHasSigned(!pad.isEmpty())
        // Re-emit so the parent's saved image matches the live (resized)
        // canvas, not the stale-resolution PNG captured before resize.
        onSignatureChange({
          image: pad.isEmpty() ? null : pad.toDataURL('image/png'),
          name: nameRef.current,
        })
      } else {
        setHasSigned(false)
      }
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
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
        <div className="border border-gray-300 dark:border-gray-600 rounded-md bg-white overflow-hidden touch-none">
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: 150 }}
          />
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Sign above with finger or stylus</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Printed Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-3 sm:py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="Customer's full name"
        />
      </div>
    </div>
  )
}
