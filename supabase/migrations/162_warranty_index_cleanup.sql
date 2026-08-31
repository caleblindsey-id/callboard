-- Migration 162: drop the pre-redesign warranty worklist index.
-- idx_service_tickets_warranty_open_credit (migration 119) keyed on
-- billing_type + status='completed' and never covered the billed-unclaimed
-- leg; idx_service_tickets_warranty_worklist (migration 160) serves every
-- queue bucket since the Round 3 cutover. No code paths filter on
-- billing_type for warranty anymore.
DROP INDEX IF EXISTS idx_service_tickets_warranty_open_credit;
