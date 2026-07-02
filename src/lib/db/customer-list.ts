// Shared between the server helper (lib/db/customers.ts) and the client-side
// search in app/customers/CustomerList.tsx so the column list and page cap
// can't drift apart. Keep this module free of server-only imports.

// List columns the customers list page actually renders. The detail page uses
// the wider `getCustomer` helper for the full row.
export const CUSTOMER_LIST_COLUMNS =
  'id, name, account_number, ar_terms, credit_hold, active, billing_city, billing_state, po_required, show_pricing_on_pm_pdf'

export const CUSTOMER_LIST_LIMIT = 50
