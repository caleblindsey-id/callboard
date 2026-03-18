import { createClient } from '@/lib/supabase/server'
import { PmScheduleRow, PmScheduleInsert } from '@/types/database'

export async function getSchedulesByEquipment(equipmentId: string): Promise<PmScheduleRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pm_schedules')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('created_at')

  if (error) throw error
  return data
}

export async function createSchedule(data: PmScheduleInsert): Promise<PmScheduleRow> {
  const supabase = await createClient()

  const { data: created, error } = await supabase
    .from('pm_schedules')
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return created
}

export async function updateSchedule(
  id: string,
  data: Partial<PmScheduleInsert>
): Promise<PmScheduleRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('pm_schedules')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
}

export async function deactivateSchedule(id: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('pm_schedules')
    .update({ active: false })
    .eq('id', id)

  if (error) throw error
}
