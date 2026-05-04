import { getCustomer } from '@/lib/db/customers'
import { getEquipment } from '@/lib/db/equipment'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import ActiveToggle from './ActiveToggle'
import ShowPricingToggle from './ShowPricingToggle'
import AutoApproveThresholdInput from './AutoApproveThresholdInput'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const { id } = await params
  const customerId = parseInt(id)
  if (isNaN(customerId)) notFound()

  const [customer, equipment] = await Promise.all([
    getCustomer(customerId),
    getEquipment({ customerId }),
  ])

  if (!customer) notFound()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/customers"
          className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {customer.name}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Account: {customer.account_number ?? '—'}
          </p>
        </div>
        <ActiveToggle customerId={customer.id} isActive={customer.active} />
      </div>

      {customer.credit_hold && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <CreditHoldBadge />
          <span className="text-sm text-red-800 dark:text-red-300 font-medium">
            This customer is on credit hold.
          </span>
        </div>
      )}

      {/* Customer info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Customer Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Name</span>
            <p className="text-gray-900 dark:text-white font-medium">{customer.name}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Account Number</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {customer.account_number ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">AR Terms</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {customer.ar_terms ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Billing Address</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {customer.billing_address ?? '—'}
            </p>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700">
          <ShowPricingToggle
            customerId={customer.id}
            showPricing={customer.show_pricing_on_pm_pdf}
          />
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <AutoApproveThresholdInput
            customerId={customer.id}
            threshold={customer.auto_approve_threshold}
          />
        </div>
      </div>

      {/* Contacts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Contacts
          </h2>
        </div>
        {customer.contacts.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No contacts on file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Name</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Email</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Phone</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {customer.contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td className="px-5 py-3 text-gray-900 dark:text-white">{contact.name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{contact.email ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{contact.phone ?? '—'}</td>
                    <td className="px-5 py-3">
                      {contact.is_primary && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-300">
                          Primary
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ship-To Locations */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Ship-To Locations
          </h2>
        </div>
        {customer.ship_to_locations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No ship-to locations on file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Name</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Address</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Contact</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {customer.ship_to_locations.map((loc) => (
                  <tr key={loc.id}>
                    <td className="px-5 py-3 text-gray-900 dark:text-white">{loc.name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{loc.contact ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{loc.email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Equipment */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Equipment
          </h2>
        </div>
        {equipment.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No equipment on file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Make / Model</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Serial Number</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {equipment.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-5 py-3 text-gray-900 dark:text-white">
                      <Link
                        href={`/equipment/${e.id}`}
                        className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
                      >
                        {[e.make, e.model].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{e.serial_number ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{e.location_on_site ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          e.active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {e.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
