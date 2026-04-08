import { getUsers } from '@/lib/db/users'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { getSetting } from '@/lib/db/settings'
import { SyncLogRow } from '@/types/database'
import SettingsContent from './SettingsContent'

export default async function SettingsPage() {
  await requireRole('manager', 'coordinator')
  const [users, syncLog, laborRate] = await Promise.all([
    getUsers(),
    getSyncLog(),
    getSetting('labor_rate_per_hour'),
  ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage users and view sync history
        </p>
      </div>
      <SettingsContent
        users={users}
        syncLog={syncLog}
        laborRate={laborRate ?? '75'}
      />
    </div>
  )
}

async function getSyncLog(): Promise<SyncLogRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) return []
  return data
}
