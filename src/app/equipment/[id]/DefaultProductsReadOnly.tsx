import { DefaultProduct } from '@/types/database'

interface DefaultProductsReadOnlyProps {
  products: DefaultProduct[]
}

// Read-only view of an equipment's default products for technicians. Managers get
// the editable DefaultProductsSection; techs only need to see what auto-attaches to
// their PM ticket. Pure props in, no interactivity — renders on the server.
export default function DefaultProductsReadOnly({
  products,
}: DefaultProductsReadOnlyProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Default Products
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Automatically included on every PM ticket at no charge
        </p>
      </div>

      <div className="p-5">
        {products.length > 0 ? (
          <div className="space-y-2">
            {products.map((dp) => (
              <div
                key={dp.synergy_product_id}
                className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-sm"
              >
                <span className="flex-1 text-gray-900 dark:text-white">{dp.description}</span>
                <span className="shrink-0 text-gray-500 dark:text-gray-400 font-medium">
                  Qty {dp.quantity}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No default products configured.</p>
        )}
      </div>
    </div>
  )
}
