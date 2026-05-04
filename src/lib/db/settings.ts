import { createClient } from '@/lib/supabase/server'

const RATE_TYPE_KEY: Record<string, string> = {
  standard:   'labor_rate_per_hour',
  industrial: 'industrial_labor_rate_per_hour',
  vacuum:     'vacuum_labor_rate_per_hour',
}

export async function getLaborRate(type: string): Promise<number> {
  const key = RATE_TYPE_KEY[type] ?? RATE_TYPE_KEY.standard
  const val = await getSetting(key)
  const n = parseFloat(val ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 75
}

export async function getSetting(key: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // not found
    throw error
  }
  return data.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  if (error) throw error
}
