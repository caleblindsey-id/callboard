-- 098_pm_synergy_invoice_number.sql
-- PM billing gate: exporting a PM billing PDF no longer marks tickets 'billed'.
-- A ticket only becomes 'billed' once a manager enters the SynergyERP invoice
-- number for that PM work order (one invoice per WO). This column captures that
-- proof-of-invoicing. Mirrors how service_tickets gate on synergy_order_number.

ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS synergy_invoice_number VARCHAR;

-- Reload PostgREST schema cache so the new column is selectable over REST
-- immediately (the app selects it in the billing queries).
NOTIFY pgrst, 'reload schema';
