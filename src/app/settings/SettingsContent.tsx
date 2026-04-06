'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UserRow, UserRole, SyncLogRow } from '@/types/database'
import { X, Info } from 'lucide-react'

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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            Users
          </h2>
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
          >
            Add User
          </button>
        </div>

        <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-xs text-blue-700">
            Auth accounts must be created separately in the Supabase dashboard.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Role</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Hourly Rate</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-5 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <UserTableRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync log section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            Sync Log
          </h2>
        </div>
        {syncLog.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No sync history.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Started</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Completed</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Records</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {syncLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3 text-gray-900 capitalize">
                      {entry.sync_type ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {new Date(entry.started_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {entry.completed_at
                        ? new Date(entry.completed_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {entry.records_synced ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          entry.status === 'success'
                            ? 'bg-green-100 text-green-800'
                            : entry.status === 'running'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-red-600 max-w-xs truncate">
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
  const [loading, setLoading] = useState(false)
  const [editingCost, setEditingCost] = useState(false)
  const [hourlyCost, setHourlyCost] = useState(user.hourly_cost?.toString() ?? '')
  const [savingCost, setSavingCost] = useState(false)

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
      <td className="px-5 py-3 text-gray-900 font-medium">{user.name}</td>
      <td className="px-5 py-3 text-gray-600">{user.email}</td>
      <td className="px-5 py-3 text-gray-600 capitalize">{user.role ?? '—'}</td>
      <td className="px-5 py-3">
        {user.role === 'technician' ? (
          editingCost ? (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={hourlyCost}
                onChange={(e) => setHourlyCost(e.target.value)}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder="0.00"
              />
              <button
                onClick={handleSaveCost}
                disabled={savingCost}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {savingCost ? '...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingCost(false); setHourlyCost(user.hourly_cost?.toString() ?? '') }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingCost(true)}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {user.hourly_cost != null ? `$${user.hourly_cost.toFixed(2)}/hr` : 'Set rate'}
            </button>
          )
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            user.active
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          System Settings
        </h2>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-end gap-3 max-w-sm">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Labor Rate ($/hr)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={rate}
              onChange={(e) => { setRate(e.target.value); setSaved(false) }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
        <p className="text-xs text-gray-500 mt-2">
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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('technician')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: insertError } = await supabase.from('users').insert({
      email,
      name,
      role,
      active: true,
    } )

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    setName('')
    setEmail('')
    setRole('technician')
    setLoading(false)
    onCreated()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Add User</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="technician">Technician</option>
              <option value="coordinator">Coordinator</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
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
      </div>
    </div>
  )
}
