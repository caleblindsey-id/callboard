import { getUsers } from '@/lib/db/users'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { getSetting } from '@/lib/db/settings'
import { getAllSalesReps } from '@/lib/db/sales-reps'
import { getAllSupplyCatalog } from '@/lib/db/supply-requests'
import { SyncLogRow } from '@/types/database'
import SettingsContent from './SettingsContent'

export default async function SettingsPage({
  searchParams,
}: {
  // Next 15+ delivers searchParams as a Promise — reading properties without
  // awaiting silently yields undefined (see parts-queue/page.tsx).
  searchParams?: Promise<{ tab?: string | string[] }>
}) {
  await requireRole('super_admin')
  const params = (await searchParams) ?? {}
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const [users, syncLog, laborRate, industrialLaborRate, vacuumLaborRate, tripCharge, companyName, serviceEmail, servicePhone, arEmail, warrantyReminderEmail, pickupAddress, pickupHours, passcodeHash, salesReps, supplyCatalog] = await Promise.all([
    getUsers(),
    getSyncLog(),
    getSetting('labor_rate_per_hour'),
    getSetting('industrial_labor_rate_per_hour'),
    getSetting('vacuum_labor_rate_per_hour'),
    getSetting('trip_charge_amount'),
    getSetting('company_name'),
    getSetting('service_email'),
    getSetting('service_phone'),
    getSetting('ar_email'),
    getSetting('warranty_reminder_email'),
    getSetting('pickup_address'),
    getSetting('pickup_hours'),
    getSetting('credit_hold_release_passcode_hash'),
    getAllSalesReps(),
    getAllSupplyCatalog(),
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
        industrialLaborRate={industrialLaborRate ?? '120'}
        vacuumLaborRate={vacuumLaborRate ?? '120'}
        tripCharge={tripCharge ?? '0'}
        companyName={companyName ?? ''}
        serviceEmail={serviceEmail ?? ''}
        servicePhone={servicePhone ?? ''}
        arEmail={arEmail ?? ''}
        warrantyReminderEmail={warrantyReminderEmail ?? ''}
        pickupAddress={pickupAddress ?? ''}
        pickupHours={pickupHours ?? ''}
        passcodeConfigured={Boolean(passcodeHash && passcodeHash.length > 0)}
        salesReps={salesReps}
        supplyCatalog={supplyCatalog}
        initialTab={rawTab ?? ''}
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
