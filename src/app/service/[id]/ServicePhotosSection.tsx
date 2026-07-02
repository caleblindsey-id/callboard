'use client'

import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import type { TicketPhoto } from '@/types/database'

export type PhotoWithPreview = TicketPhoto & { previewUrl?: string }

interface ServicePhotosSectionProps {
  ticketId: string
  photos: PhotoWithPreview[]
  // Parent owns the photos array — it feeds auto-save and the completion
  // submit payload, so this stays a controlled component (DiagnosticFeeCard
  // pattern). Upload/delete state that only this section reads lives here.
  onPhotosChange: React.Dispatch<React.SetStateAction<PhotoWithPreview[]>>
  // Upload-in-flight flag is parent-owned too — it also disables the two
  // "Mark Complete" submit buttons outside this section.
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  onError: (msg: string | null) => void
}

/**
 * Photos sub-section of the completion form: collapsible gallery + uploader.
 * Extracted verbatim from ServiceTicketDetail (audit P3 refactor, round 1).
 */
export default function ServicePhotosSection({
  ticketId,
  photos,
  onPhotosChange,
  uploading,
  onUploadingChange,
  onError,
}: ServicePhotosSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    onUploadingChange(true)
    onError(null)
    try {
      const supabase = createClient()
      // Upload in parallel — Supabase Storage handles concurrent writes; each
      // path is uniquely UUID'd. Serial awaits added 5x latency on 5-photo
      // uploads over cellular.
      const newPhotos = await Promise.all(
        Array.from(files).map(async (file) => {
          const compressed = await compressImage(file)
          const id = crypto.randomUUID()
          const path = `${ticketId}/${id}.jpg`
          const { error: uploadError } = await supabase.storage
            .from('ticket-photos')
            .upload(path, compressed, { contentType: 'image/jpeg' })
          if (uploadError) throw uploadError
          return {
            storage_path: path,
            uploaded_at: new Date().toISOString(),
            previewUrl: URL.createObjectURL(compressed),
          } as PhotoWithPreview
        })
      )
      onPhotosChange((prev) => [...prev, ...newPhotos])
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      onUploadingChange(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePhotoDelete(index: number) {
    const photo = photos[index]
    const supabase = createClient()
    const { error: removeError } = await supabase.storage
      .from('ticket-photos')
      .remove([photo.storage_path])
    if (removeError) {
      onError('Failed to delete photo. Please try again.')
      return
    }
    if (photo.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(photo.previewUrl)
    }
    onPhotosChange((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    /* Photos — collapsible sub-section. Default-open whenever
       photos exist so the tech can review what they've captured
       without an extra tap. */
    <details open={photos.length > 0} className="rounded-md border border-gray-200 dark:border-gray-700">
      <summary className="px-3 py-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 marker:content-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
        <span>Service Photos{photos.length > 0 ? ` (${photos.length})` : ''}</span>
        <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className="p-3 pt-0">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {photos.map((photo, i) => (
            <div key={photo.storage_path} className="relative aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700">
              {photo.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.previewUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">Loading...</div>
              )}
              <button
                type="button"
                onClick={() => handlePhotoDelete(i)}
                className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center bg-black/60 text-white rounded-full text-sm hover:bg-black/80"
                style={{ minHeight: 44, minWidth: 44, marginTop: -10, marginRight: -10 }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      {/* No `capture` attribute: on mobile this opens the native picker
          (Photo Library / Take Photo / Choose File) instead of forcing
          the camera, matching PM tickets and the rest of the app.
          `multiple` keeps batch upload working. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotoUpload}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
      >
        {uploading ? 'Uploading...' : '+ Add Photo'}
      </button>
      </div>
    </details>
  )
}
