'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UserRow, UserRole, SyncLogRow } from '@/types/database'
import { useUser } from '@/components/UserProvider'
import { X } from 'lucide-react'

interface SettingsContentProps {
  users: UserRow[]
  syncLog: SyncLogRow[]
  laborRate: string
}

export default function SettingsContent({ users, syncLog, laborRate }: SettingsContentProps) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      {/* System Settings */}
      <LaborRateSetting initialRate={laborRate} />

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

  async function handleRoleChange(newRole: UserRole) {
    if (newRole === user.role) return
    setSavingRole(true)
    const supabase = createClient()
    await supabase.from('users').update({ role: newRole }).eq('id', user.id)
    setSavingRole(false)
    router.refresh()
  }

  async function handleToggleActive() {
    setLoading(true)
    const supabase = createClient()
    await supabase
      .from('users')
      .update({ active: !user.active } )
      .eq('id', user.id)
    setLoading(false)
    router.refresh()
  }

  async function handleSaveCost() {
    setSavingCost(true)
    const supabase = createClient()
    await supabase
      .from('users')
      .update({ hourly_cost: hourlyCost ? parseFloat(hourlyCost) : null } )
      .eq('id', user.id)
    setSavingCost(false)
    setEditingCost(false)
    router.refresh()
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
        <button
          onClick={handleToggleActive}
          disabled={loading}
          className="text-sm font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50"
        >
          {loading ? '...' : user.active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  )
}

function LaborRateSetting({ initialRate }: { initialRate: string }) {
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
        body: JSON.stringify({ key: 'labor_rate_per_hour', value: rate }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          System Settings
        </h2>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-end gap-3 max-w-sm">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Labor Rate ($/hr)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={rate}
              onChange={(e) => { setRate(e.target.value); setSaved(false) }}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
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
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Used to calculate suggested billing amounts on ticket completion.
        </p>
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
  const TEMP_PASSWORD = 'ChangeMeNow1!'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('technician')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  function handleClose() {
    setName('')
    setEmail('')
    setRole('technician')
    setError(null)
    setCreatedEmail(null)
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

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create user.')
      setLoading(false)
      return
    }

    setCreatedEmail(email)
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
                <span className="font-mono text-gray-900 dark:text-white">{TEMP_PASSWORD}</span>
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
