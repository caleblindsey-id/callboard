-- Add customer signature fields to pm_tickets
ALTER TABLE pm_tickets
  ADD COLUMN customer_signature TEXT,
  ADD COLUMN customer_signature_name TEXT;
