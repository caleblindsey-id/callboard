import { createClient } from '@/lib/supabase/server'
import type { PartsQueueRow } from '@/types/database'

// Columns the queue page actually renders. customer_id, assigned_technician_id,
// and synergy_order_number are present on the view but never displayed —
// keeping them out of the wire payload meaningfully shrinks transfer size on
// busy weeks. synergy_product_id stays so partToRow can preserve it through
// optimistic updates.
const QUEUE_COLUMNS = `
  source, ticket_id, work_order_number, part_index,
  customer_name, assigned_technician_name,
  requested_at, description, quantity, vendor,
  product_number, synergy_product_id, vendor_item_code, po_number,
  status, cancelled, cancel_reason,
  ordered_at, received_at, ordered_by, received_by
`

export async function getPartsQueue(): Promise<PartsQueueRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('parts_order_queue')
    .select(QUEUE_COLUMNS)
    .order('requested_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as PartsQueueRow[]
}
