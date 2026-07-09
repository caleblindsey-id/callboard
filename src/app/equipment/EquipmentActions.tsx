'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/Button'
import AddEquipmentModal from './AddEquipmentModal'

/**
 * Equipment list header action (standard-draft dimension 2): "Add Equipment", moved out
 * of the filter row into `PageHeader`'s `actions` slot. Self-contained (owns its own
 * modal-open state) so the server-rendered `page.tsx` can pass it straight into
 * `PageHeader` without lifting `EquipmentList`'s client state up. Mirrors
 * `tickets/TicketBoardActions.tsx`.
 */
export default function EquipmentActions() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add Equipment
      </Button>

      <AddEquipmentModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
