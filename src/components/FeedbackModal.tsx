'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Paperclip, Bug, Lightbulb, HelpCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image-utils'
import Modal from '@/components/ui/Modal'

type Category = 'bug' | 'idea' | 'question'

const CATEGORIES: { value: Category; label: string; icon: typeof Bug }[] = [
  { value: 'bug',      label: 'Bug',      icon: Bug },
  { value: 'idea',     label: 'Idea',     icon: Lightbulb },
  { value: 'question', label: 'Question', icon: HelpCircle },
]

const MAX_BODY = 4000

interface FeedbackModalProps {
  onClose: () => void
  initialAttachment?: Blob | null
  captureFailed?: boolean
}

export default function FeedbackModal({ onClose, initialAttachment, captureFailed = false }: FeedbackModalProps) {
  const pathname = usePathname()
  const [category, setCategory] = useState<Category>('bug')
  const [body, setBody] = useState('')
  const [attachment, setAttachment] = useState<{ blob: Blob; previewUrl: string; kind: 'screenshot' | 'upload' } | null>(() =>
    initialAttachment
      ? { blob: initialAttachment, previewUrl: URL.createObjectURL(initialAttachment), kind: 'screenshot' }
      : null
  )
  const [attachError, setAttachError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [attachment])

  // Esc to close (unless mid-submit)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [submitting, onClose])

  const handleFile = async (file: File | null) => {
    setAttachError(null)
    if (!file) {
      setAttachment(null)
      return
    }
    try {
      const blob = await compressImage(file)
      setAttachment({ blob, previewUrl: URL.createObjectURL(blob), kind: 'upload' })
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : 'Could not read photo.')
    }
  }

  const removeAttachment = () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    setAttachment(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitError(null)

    const trimmed = body.trim()
    if (!trimmed) {
      setSubmitError('Please describe what you want to tell us.')
      return
    }

    setSubmitting(true)
    try {
      let attachment_path: string | null = null

      if (attachment) {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('You appear to be signed out. Refresh and try again.')

        const ts = Date.now()
        const path = `${user.id}/${ts}.jpg`
        const { error: upErr } = await supabase.storage
          .from('feedback-attachments')
          .upload(path, attachment.blob, { contentType: 'image/jpeg' })
        if (upErr) throw new Error(`Couldn't upload the photo: ${upErr.message}`)
        attachment_path = path
      }

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          body: trimmed,
          attachment_path,
          page_url: pathname,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Submit failed (${res.status})`)
      }

      setSubmitted(true)
      setTimeout(onClose, 1500)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} dismissible={!submitting} title="Send feedback" sheet size="md">
      {submitted ? (
          <div className="px-5 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
              <span className="text-2xl">✓</span>
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">Thanks — we'll review it.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            {/* Category */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                What is this?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(({ value, label, icon: Icon }) => {
                  const selected = category === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={
                        'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition ' +
                        (selected
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5')
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Body */}
            <div>
              <label htmlFor="feedback-body" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                What's going on?
              </label>
              <textarea
                id="feedback-body"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                rows={5}
                placeholder={
                  category === 'bug'
                    ? 'What broke, and what were you trying to do?'
                    : category === 'idea'
                      ? 'What would make this better?'
                      : 'What are you trying to figure out?'
                }
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-white/10 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                autoFocus
                required
              />
              <div className="mt-1 text-right text-[11px] text-gray-400">
                {body.length} / {MAX_BODY}
              </div>
            </div>

            {/* Attachment */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Screenshot or photo <span className="font-normal normal-case text-gray-400">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
                /* @ts-ignore — capture attribute is mobile-only and not in the TS DOM lib */
                capture="environment"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {!attachment ? (
                <>
                  {captureFailed && (
                    <div className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
                      Couldn&apos;t auto-capture this page — attach a screenshot or photo manually.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-3 py-3 text-sm font-medium text-gray-600 transition hover:border-gray-400 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    <Paperclip className="h-4 w-4" />
                    Attach
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-white/10 dark:bg-white/5">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.kind === 'screenshot' ? 'Screenshot of this page' : 'Attached photo'}
                    className="h-14 w-14 rounded object-cover"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
                      {attachment.kind === 'screenshot' ? 'Screenshot of this page' : 'Attached photo'}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-0.5 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Replace with a photo
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </div>
              )}
              {attachError && (
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">{attachError}</div>
              )}
            </div>

            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || body.trim().length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
    </Modal>
  )
}
