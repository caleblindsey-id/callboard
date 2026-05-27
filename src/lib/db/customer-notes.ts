import { createClient } from '@/lib/supabase/server'
import { CustomerNoteRow } from '@/types/database'

export type CustomerNoteWithAuthor = CustomerNoteRow & {
  users: { name: string } | null
}

export async function getCustomerNotes(
  customerId: number
): Promise<CustomerNoteWithAuthor[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customer_notes')
    .select('*, users(name)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as CustomerNoteWithAuthor[]
}

export async function createCustomerNote(
  customerId: number,
  userId: string,
  noteText: string
): Promise<CustomerNoteRow> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customer_notes')
    .insert({ customer_id: customerId, user_id: userId, note_text: noteText })
    .select()
    .single()

  if (error) throw error
  return data as CustomerNoteRow
}
