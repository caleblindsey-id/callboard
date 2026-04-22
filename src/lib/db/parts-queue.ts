import { createClient } from '@/lib/supabase/server'
import type { PartsQueueRow } from '@/types/database'

export async function getPartsQueue(): Promise<PartsQueueRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('parts_order_queue')
    .select('*')
    .order('requested_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as PartsQueueRow[]
}
