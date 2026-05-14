'use client'

import { useRef, useState } from 'react'
import { MessageSquarePlus, Loader2 } from 'lucide-react'
import FeedbackModal from './FeedbackModal'

export default function FeedbackFAB() {
  const fabRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [pendingShot, setPendingShot] = useState<Blob | null>(null)
  const [captureFailed, setCaptureFailed] = useState(false)

  const handleClick = async () => {
    if (capturing || open) return
    setCapturing(true)
    let blob: Blob | null = null
    let failed = false
    try {
      const { default: html2canvas } = await import('html2canvas-pro')
      const fab = fabRef.current
      const canvas = await html2canvas(document.documentElement, {
        ignoreElements: (el) => el === fab,
        useCORS: true,
        logging: false,
        // Full devicePixelRatio on retina is overkill for our use case and
        // hurts mobile memory. 0.75 on standard, 1.0 on retina is a sweet spot.
        scale: typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 1 : 0.75,
        backgroundColor: null,
      })
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      )
      if (!blob) failed = true
    } catch (err) {
      console.error('[FeedbackFAB] screenshot capture failed', err)
      blob = null
      failed = true
    } finally {
      setPendingShot(blob)
      setCaptureFailed(failed)
      setCapturing(false)
      setOpen(true)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setPendingShot(null)
    setCaptureFailed(false)
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        aria-label="Send feedback"
        onClick={handleClick}
        disabled={capturing}
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-400/40 disabled:cursor-wait dark:bg-blue-500 dark:hover:bg-blue-400"
      >
        {capturing ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <MessageSquarePlus className="h-6 w-6" />
        )}
      </button>
      {open && <FeedbackModal onClose={handleClose} initialAttachment={pendingShot} captureFailed={captureFailed} />}
    </>
  )
}
