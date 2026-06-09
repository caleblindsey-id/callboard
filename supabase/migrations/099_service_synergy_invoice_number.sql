-- 099_service_synergy_invoice_number.sql
-- Service billing gate: a completed service ticket only becomes 'billed' once a
-- manager enters the SynergyERP invoice number for that work order (one invoice
-- per WO). This column captures that proof-of-invoicing.
--
-- Previously the gate reused synergy_order_number, but that column is the
-- parts-ordering order # — validated against the ERP order table by the nightly
-- job and matched to part #s in the Parts Queue. An invoice # is a different
-- document, so it gets its own column. Mirrors pm_tickets.synergy_invoice_number
-- (migration 098); synergy_order_number stays the parts-ordering field.

ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS synergy_invoice_number VARCHAR;

-- Reload PostgREST schema cache so the new column is selectable over REST
-- immediately (the app selects it in the billing queries).
NOTIFY pgrst, 'reload schema';
