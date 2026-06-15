'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRow, UserRole, SyncLogRow, SalesRep, SalesRepKind } from '@/types/database'

const KIND_LABEL: Record<SalesRepKind, string> = {
  branch_manager: 'Branch Manager',
  sales_manager: 'Sales Manager',
  rep: 'Sales Rep',
}

const KIND_BADGE: Record<SalesRepKind, string> = {
  branch_manager: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  sales_manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  rep: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}
import { useUser } from '@/components/UserProvider'
import { X } from 'lucide-react'
import EnablePushButton from '@/components/push/EnablePushButton'

interface SettingsContentProps {
  users: UserRow[]
  syncLog: SyncLogRow[]
  laborRate: string
  industrialLaborRate: string
  vacuumLaborRate: string
  tripCharge: string
  companyName: string
  serviceEmail: string
  servicePhone: string
  arEmail: string
  pickupAddress: string
  pickupHours: string
  passcodeConfigured: boolean
  salesReps: SalesRep[]
}

export default function SettingsContent({
  users,
  syncLog,
  laborRate,
  industrialLaborRate,
  vacuumLaborRate,
  tripCharge,
  companyName,
  serviceEmail,
  servicePhone,
  arEmail,
  pickupAddress,
  pickupHours,
  passcodeConfigured,
  salesReps,
}: SettingsContentProps) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      {/* System Settings */}
      <LaborRatesSetting
        initialRate={laborRate}
        initialIndustrialRate={industrialLaborRate}
        initialVacuumRate={vacuumLaborRate}
      />

      {/* Trip Charge — flat per-ticket fee for sending a tech out */}
      <TripChargeSetting initialTripCharge={tripCharge} />

      {/* Customer PDF Branding */}
      <PdfBrandingSetting
        initialCompanyName={companyName}
        initialServiceEmail={serviceEmail}
        initialServicePhone={servicePhone}
      />

      {/* Pickup Notifications — address/hours shown in the ready-for-pickup email */}
      <PickupNotificationsSetting
        initialAddress={pickupAddress}
        initialHours={pickupHours}
      />

      {/* Push notifications — per-device opt-in. The assignment push targets the
          assigned tech; techs enable it from their service board, this is the
          same control for anyone who reaches Settings (and for testing). */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Notifications
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Turn on push notifications on this device to be alerted when a service ticket is
            assigned to you.
          </p>
          <EnablePushButton />
        </div>
      </div>

      {/* Credit Review — AR notification + release passcode */}
      <CreditReviewSetting
        initialArEmail={arEmail}
        passcodeConfigured={passcodeConfigured}
      />

      {/* Sales Reps — destination list for forwarded equipment leads */}
      <SalesRepsSection salesReps={salesReps} />

      {/* Users section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Users
          </h2>
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
          >
            Add User
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Email</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Role</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Hourly Rate</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Create Tickets</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {users.map((user) => (
                <UserTableRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync log section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Sync Log
          </h2>
        </div>
        {syncLog.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No sync history.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Type</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Started</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Completed</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Records</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {syncLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3 text-gray-900 dark:text-white capitalize">
                      {entry.sync_type ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-xs">
                      {new Date(entry.started_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-xs">
                      {entry.completed_at
                        ? new Date(entry.completed_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {entry.records_synced ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          entry.status === 'success'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : entry.status === 'running'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
                      {entry.error_message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}

function UserTableRow({ user }: { user: UserRow }) {
  const router = useRouter()
  const currentUser = useUser()
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const [loading, setLoading] = useState(false)
  const [editingCost, setEditingCost] = useState(false)
  const [hourlyCost, setHourlyCost] = useState(user.hourly_cost?.toString() ?? '')
  const [savingCost, setSavingCost] = useState(false)
  const [savingRole, setSavingRole] = useState(false)
  const [savingCreate, setSavingCreate] = useState(false)

  const [error, setError] = useState<string | null>(null)

  async function patchUser(body: Record<string, unknown>): Promise<boolean> {
    setError(null)
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to update user.')
      return false
    }
    return true
  }

  async function handleRoleChange(newRole: UserRole) {
    if (newRole === user.role) return
    setSavingRole(true)
    const ok = await patchUser({ role: newRole })
    setSavingRole(false)
    if (ok) router.refresh()
  }

  async function handleToggleActive() {
    setLoading(true)
    const ok = await patchUser({ active: !user.active })
    setLoading(false)
    if (ok) router.refresh()
  }

  async function handleSaveCost() {
    setSavingCost(true)
    const ok = await patchUser({ hourly_cost: hourlyCost ? parseFloat(hourlyCost) : null })
    setSavingCost(false)
    if (ok) {
      setEditingCost(false)
      router.refresh()
    }
  }

  async function handleToggleCreateTickets() {
    setSavingCreate(true)
    const ok = await patchUser({ can_create_service_tickets: !user.can_create_service_tickets })
    setSavingCreate(false)
    if (ok) router.refresh()
  }

  return (
    <tr>
      <td className="px-5 py-3 text-gray-900 dark:text-white font-medium">{user.name}</td>
      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{user.email}</td>
      <td className="px-5 py-3">
        {isSuperAdmin && currentUser?.id !== user.id ? (
          <select
            value={user.role ?? ''}
            disabled={savingRole}
            onChange={(e) => handleRoleChange(e.target.value as UserRole)}
            className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:opacity-50"
          >
            <option value="technician">Technician</option>
            <option value="coordinator">Coordinator</option>
            <option value="manager">Manager</option>
            <option value="super_admin">Super Admin</option>
          </select>
        ) : (
          <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{user.role ?? '—'}</span>
        )}
      </td>
      <td className="px-5 py-3">
        {user.role === 'technician' ? (
          editingCost ? (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 dark:text-gray-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={hourlyCost}
                onChange={(e) => setHourlyCost(e.target.value)}
                className="w-20 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="0.00"
              />
              <button
                onClick={handleSaveCost}
                disabled={savingCost}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
              >
                {savingCost ? '...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingCost(false); setHourlyCost(user.hourly_cost?.toString() ?? '') }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingCost(true)}
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900"
            >
              {user.hourly_cost != null ? `$${user.hourly_cost.toFixed(2)}/hr` : 'Set rate'}
            </button>
          )
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        {user.role === 'technician' ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={user.can_create_service_tickets}
              disabled={savingCreate}
              onChange={handleToggleCreateTickets}
              className="rounded border-gray-300 dark:border-gray-600 accent-slate-600 disabled:opacity-50"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {savingCreate ? '…' : user.can_create_service_tickets ? 'Allowed' : 'Off'}
            </span>
          </label>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            user.active
              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {user.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={handleToggleActive}
            disabled={loading}
            className="text-sm font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50 text-left"
          >
            {loading ? '...' : user.active ? 'Deactivate' : 'Activate'}
          </button>
          {error && (
            <span className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

function LaborRateInput({
  label,
  settingKey,
  initialRate,
  suffix = '/hr',
}: {
  label: string
  settingKey: string
  initialRate: string
  suffix?: string
}) {
  const [rate, setRate] = useState(initialRate)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: settingKey, value: rate }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div className="relative w-36">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => { setRate(e.target.value); setSaved(false) }}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 pl-6 pr-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        {suffix && <span className="text-sm text-gray-500 dark:text-gray-400">{suffix}</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">Saved</span>
        )}
      </div>
    </div>
  )
}

function LaborRatesSetting({
  initialRate,
  initialIndustrialRate,
  initialVacuumRate,
}: {
  initialRate: string
  initialIndustrialRate: string
  initialVacuumRate: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Labor Rates
        </h2>
      </div>
      <div className="px-5 py-4 space-y-4">
        <LaborRateInput
          label="Standard"
          settingKey="labor_rate_per_hour"
          initialRate={initialRate}
        />
        <LaborRateInput
          label="Industrial"
          settingKey="industrial_labor_rate_per_hour"
          initialRate={initialIndustrialRate}
        />
        <LaborRateInput
          label="Vacuum"
          settingKey="vacuum_labor_rate_per_hour"
          initialRate={initialVacuumRate}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Used to calculate billing amounts on ticket completion. Select the rate type per ticket at creation time.
        </p>
      </div>
    </div>
  )
}

function TripChargeSetting({ initialTripCharge }: { initialTripCharge: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Trip Charge
        </h2>
      </div>
      <div className="px-5 py-4 space-y-4">
        <LaborRateInput
          label="Trip Charge Rate"
          settingKey="trip_charge_amount"
          initialRate={initialTripCharge}
          suffix="per trip"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Per-trip rate billed on field service and PM tickets — each ticket sets the number of trips (qty × this rate, like labor). Opt-in: tickets default to 0 trips, so no trip charge is added unless someone enters a quantity. Set to $0 to turn it off entirely.
        </p>
      </div>
    </div>
  )
}

function PdfBrandingSetting({
  initialCompanyName,
  initialServiceEmail,
  initialServicePhone,
}: {
  initialCompanyName: string
  initialServiceEmail: string
  initialServicePhone: string
}) {
  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [serviceEmail, setServiceEmail] = useState(initialServiceEmail)
  const [servicePhone, setServicePhone] = useState(initialServicePhone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const patches = [
        { key: 'company_name', value: companyName },
        { key: 'service_email', value: serviceEmail },
        { key: 'service_phone', value: servicePhone },
      ].map((body) =>
        fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
      const responses = await Promise.all(patches)
      if (responses.every((r) => r.ok)) {
        setSaved(true)
      } else {
        setError('One or more values failed to save.')
      }
    } catch {
      setError('Could not save branding settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Customer PDF Branding
        </h2>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Company Name
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => { setCompanyName(e.target.value); setSaved(false) }}
            placeholder="Imperial Dade"
            className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Service Email
          </label>
          <input
            type="email"
            value={serviceEmail}
            onChange={(e) => { setServiceEmail(e.target.value); setSaved(false) }}
            placeholder="service@example.com"
            className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Service Phone
          </label>
          <input
            type="text"
            value={servicePhone}
            onChange={(e) => { setServicePhone(e.target.value); setSaved(false) }}
            placeholder="(205) 555-1234"
            className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Saved</span>
          )}
          {error && (
            <span className="text-sm text-red-600 font-medium">{error}</span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Shown in the header of the customer PM work order PDF. Leave email or phone blank to omit those rows.
        </p>
      </div>
    </div>
  )
}

function PickupNotificationsSetting({
  initialAddress,
  initialHours,
}: {
  initialAddress: string
  initialHours: string
}) {
  const [address, setAddress] = useState(initialAddress)
  const [hours, setHours] = useState(initialHours)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const patches = [
        { key: 'pickup_address', value: address },
        { key: 'pickup_hours', value: hours },
      ].map((body) =>
        fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
      const responses = await Promise.all(patches)
      if (responses.every((r) => r.ok)) {
        setSaved(true)
      } else {
        setError('One or more values failed to save.')
      }
    } catch {
      setError('Could not save pickup settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Pickup Notifications
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Shown in the &quot;ready for pickup&quot; email customers receive when an inside repair is
          invoiced. Leave either blank to omit it from the email.
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Pickup Address
          </label>
          <textarea
            rows={3}
            value={address}
            onChange={(e) => { setAddress(e.target.value); setSaved(false) }}
            placeholder={'Imperial Dade\n1234 Example Rd\nBirmingham, AL 35201'}
            className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Pickup Hours
          </label>
          <input
            type="text"
            value={hours}
            onChange={(e) => { setHours(e.target.value); setSaved(false) }}
            placeholder="Mon–Fri, 7:30 AM – 4:30 PM"
            className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
          {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
        </div>
      </div>
    </div>
  )
}

function CreditReviewSetting({
  initialArEmail,
  passcodeConfigured,
}: {
  initialArEmail: string
  passcodeConfigured: boolean
}) {
  const [arEmail, setArEmail] = useState(initialArEmail)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const [configured, setConfigured] = useState(passcodeConfigured)
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const [passSaved, setPassSaved] = useState(false)
  const [passError, setPassError] = useState<string | null>(null)

  async function handleSaveEmail() {
    setSavingEmail(true)
    setEmailSaved(false)
    setEmailError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ar_email', value: arEmail }),
      })
      if (res.ok) {
        setEmailSaved(true)
      } else {
        const data = await res.json().catch(() => ({}))
        setEmailError(data.error ?? 'Failed to save AR email.')
      }
    } catch {
      setEmailError('Could not save AR email.')
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleSavePasscode() {
    setPassError(null)
    setPassSaved(false)
    if (passcode.length < 8) {
      setPassError('Passcode must be at least 8 characters.')
      return
    }
    if (passcode !== confirm) {
      setPassError('Passcodes do not match.')
      return
    }
    setSavingPass(true)
    try {
      const res = await fetch('/api/settings/credit-passcode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      })
      if (res.ok) {
        setPassSaved(true)
        setConfigured(true)
        setPasscode('')
        setConfirm('')
      } else {
        const data = await res.json().catch(() => ({}))
        setPassError(data.error ?? 'Failed to update passcode.')
      }
    } catch {
      setPassError('Could not update passcode.')
    } finally {
      setSavingPass(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Credit Review
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          When work is created for a customer on credit hold, AR is emailed to release or block the
          order. Managers unblock locked orders with the release passcode.
        </p>
      </div>
      <div className="px-5 py-4 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            AR notification email(s)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={arEmail}
              onChange={(e) => { setArEmail(e.target.value); setEmailSaved(false) }}
              placeholder="ar@example.com, billing@example.com"
              className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <button
              onClick={handleSaveEmail}
              disabled={savingEmail}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {savingEmail ? 'Saving...' : 'Save'}
            </button>
            {emailSaved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            {emailError && <span className="text-sm text-red-600 font-medium">{emailError}</span>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Separate multiple addresses with commas. Required — without it, credit-hold work is still
            gated but nobody is notified.
          </p>
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Release passcode
            </label>
            <span
              className={`text-xs font-medium ${
                configured ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {configured ? '✓ A passcode is set' : '⚠ No passcode set — managers cannot unblock'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
            <input
              type="password"
              autoComplete="new-password"
              value={passcode}
              onChange={(e) => { setPasscode(e.target.value); setPassSaved(false) }}
              placeholder="New passcode"
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setPassSaved(false) }}
              placeholder="Confirm passcode"
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleSavePasscode}
              disabled={savingPass}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {savingPass ? 'Saving...' : configured ? 'Update passcode' : 'Set passcode'}
            </button>
            {passSaved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            {passError && <span className="text-sm text-red-600 font-medium">{passError}</span>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Stored hashed and never shown again. Rotate it here to revoke the old one. Share only with
            managers and AR.
          </p>
        </div>
      </div>
    </div>
  )
}

function AddUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('technician')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)

  function handleClose() {
    setName('')
    setEmail('')
    setRole('technician')
    setError(null)
    setCreatedEmail(null)
    setTempPassword(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Failed to create user.')
      setLoading(false)
      return
    }

    setCreatedEmail(email)
    setTempPassword(data.tempPassword ?? null)
    setName('')
    setEmail('')
    setRole('technician')
    setLoading(false)
    onCreated()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Add User</h3>
          <button onClick={handleClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {createdEmail ? (
          <div className="space-y-4">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">User created successfully.</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Share these credentials with <span className="font-medium text-gray-900 dark:text-white">{createdEmail}</span>:
            </p>
            <div className="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Email</span>
                <span className="font-mono text-gray-900 dark:text-white">{createdEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Temp password</span>
                <span className="font-mono text-gray-900 dark:text-white">{tempPassword ?? '(unavailable)'}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              They will be prompted to set a new password on first login.
            </p>
            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="technician">Technician</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="manager">Manager</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function SalesRepsSection({ salesReps }: { salesReps: SalesRep[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<SalesRepKind>('rep')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/sales-reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        kind,
        title: title.trim() || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) {
      setError(data.error ?? 'Failed to add sales rep')
      return
    }
    setName('')
    setEmail('')
    setKind('rep')
    setTitle('')
    setAdding(false)
    router.refresh()
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Sales Reps
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Reps a manager can forward an approved equipment lead to via email. Not CallBoard users.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null) }}
            className="px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
          >
            Add Rep
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SalesRepKind)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="rep">Sales Rep</option>
              <option value="sales_manager">Sales Manager</option>
              <option value="branch_manager">Branch Manager</option>
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Title <span className="text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sales Rep"
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50"
            >
              {submitting ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setName(''); setEmail(''); setKind('rep'); setTitle(''); setError(null) }}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="basis-full text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>
      )}

      {salesReps.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No sales reps yet. Add one above to start forwarding equipment leads.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Email</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Role</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Title</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {salesReps.map((rep) => (
                <SalesRepRow key={rep.id} rep={rep} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SalesRepRow({ rep }: { rep: SalesRep }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(rep.name)
  const [email, setEmail] = useState(rep.email)
  const [kind, setKind] = useState<SalesRepKind>(rep.kind)
  const [title, setTitle] = useState(rep.title ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/sales-reps/${rep.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to update sales rep')
      return false
    }
    return true
  }

  async function handleSaveEdit() {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedTitle = title.trim()
    if (!trimmedName || !trimmedEmail) {
      setError('Name and email are required')
      return
    }
    const ok = await patch({
      name: trimmedName,
      email: trimmedEmail,
      kind,
      title: trimmedTitle || null,
    })
    if (ok) {
      setEditing(false)
      router.refresh()
    }
  }

  async function handleToggleActive() {
    const ok = await patch({ active: !rep.active })
    if (ok) router.refresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete sales rep "${rep.name}"? This cannot be undone.`)) return
    setError(null)
    setBusy(true)
    const res = await fetch(`/api/sales-reps/${rep.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to delete sales rep')
      return
    }
    router.refresh()
  }

  if (editing) {
    return (
      <tr>
        <td className="px-5 py-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </td>
        <td className="px-5 py-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </td>
        <td className="px-5 py-3">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SalesRepKind)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            <option value="rep">Sales Rep</option>
            <option value="sales_manager">Sales Manager</option>
            <option value="branch_manager">Branch Manager</option>
          </select>
        </td>
        <td className="px-5 py-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="(optional)"
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </td>
        <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-sm">—</td>
        <td className="px-5 py-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveEdit}
                disabled={busy}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 disabled:opacity-50"
              >
                {busy ? '...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setName(rep.name); setEmail(rep.email); setKind(rep.kind); setTitle(rep.title ?? ''); setError(null) }}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
            {error && <span className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</span>}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="px-5 py-3 text-gray-900 dark:text-white font-medium">{rep.name}</td>
      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{rep.email}</td>
      <td className="px-5 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_BADGE[rep.kind]}`}>
          {KIND_LABEL[rep.kind]}
        </span>
      </td>
      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{rep.title ?? '—'}</td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            rep.active
              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {rep.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={handleToggleActive}
              disabled={busy}
              className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 disabled:opacity-50"
            >
              {busy ? '...' : rep.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
          {error && <span className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</span>}
        </div>
      </td>
    </tr>
  )
}
