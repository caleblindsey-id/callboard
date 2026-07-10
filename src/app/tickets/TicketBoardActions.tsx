'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/Button'
import CreateTicketModal from './CreateTicketModal'
import GeneratePmModal from './GeneratePmModal'
import { ENTITY, newEntityLabel } from '@/lib/labels'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface TicketBoardActionsProps {
  month: number
  year: number
}

/**
 * PM board header actions (standard-draft dimension 2): "New PM Ticket" and
 * "Generate {Month} PMs", moved out of the filter row into `PageHeader`'s `actions` slot.
 * Self-contained (owns its own modal-open state) so the server-rendered `page.tsx` can pass
 * it straight into `PageHeader` without lifting `TicketBoard`'s client state up.
 *
 * Generate targets the currently LOADED `month`/`year` (this page's committed values, from
 * the URL) rather than whatever is pending-but-unapplied in the board's filter dropdowns —
 * see the round 6 build report for this behavior note.
 */
export default function TicketBoardActions({ month, year }: TicketBoardActionsProps) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  return (
    <>
      <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
        Generate {MONTHS[month - 1]} PMs
      </Button>
      <Button variant="primary" onClick={() => setCreateOpen(true)}>
        {newEntityLabel(ENTITY.pmTicket)}
      </Button>

      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <GeneratePmModal
        open={generateOpen}
        month={month}
        year={year}
        monthLabel={MONTHS[month - 1]}
        onClose={() => setGenerateOpen(false)}
        onGenerated={() => {
          setGenerateOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
