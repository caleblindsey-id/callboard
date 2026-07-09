'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react'
import Button from '@/components/Button'
import InlineError from '@/components/ui/InlineError'

interface NoteEntry {
  id: string
  note_text: string
  created_at: string
  users: { name: string } | null
}

function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

interface EquipmentNotesProps {
  equipmentId: string
  /** Round 8 de-bulk: collapsed by default alongside Service/Estimate History. */
  collapsible?: boolean
}

export default function EquipmentNotes({ equipmentId, collapsible = false }: EquipmentNotesProps) {
  const [notes, setNotes] = useState<NoteEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!collapsible)

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/equipment/${equipmentId}/notes`)
      if (!res.ok) throw new Error('Failed to load notes')
      const data = await res.json()
      setNotes(data)
    } catch {
      setError('Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [equipmentId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = noteText.trim()
    if (!text) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/equipment/${equipmentId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteText: text }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add note')
      }
      setNoteText('')
      await fetchNotes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div
        className={`px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${collapsible ? 'cursor-pointer select-none' : ''}`}
        onClick={collapsible ? () => setExpanded(!expanded) : undefined}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Equipment Notes
        </h2>
        {collapsible && (
          expanded
            ? <ChevronDown className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            : <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
        )}
      </div>

      {expanded && (
        <>
          {/* Add note form */}
          <form onSubmit={handleSubmit} className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note (e.g. common part numbers, quirks, access instructions)..."
              maxLength={2000}
              rows={2}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400 dark:text-gray-500">{noteText.length}/2000</span>
              <Button type="submit" size="mobile" disabled={!noteText.trim() || submitting}>
                <MessageSquarePlus className="h-4 w-4" />
                {submitting ? 'Adding...' : 'Add Note'}
              </Button>
            </div>
          </form>

          {error && (
            <div className="px-5 py-3">
              <InlineError message={error} />
            </div>
          )}

          {/* Notes list */}
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading notes...</div>
          ) : notes.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No notes yet.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {notes.map((note) => (
                <div key={note.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {note.users?.name ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(note.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{note.note_text}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
