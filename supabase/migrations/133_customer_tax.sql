-- Per-customer sales-tax profile, synced nightly from Synergy.
--
-- Source of truth is Synergy: cust.TaxCode -> taxcode.xDL4RecNum gives the
-- jurisdiction rate (taxcode.TaxRate, a percent e.g. 7.7500), cust.TaxType=2
-- marks the account tax-exempt, and cust.TaxExemp holds the exemption cert #.
-- The nightly sync (scripts/sync/synergy-sync.py) resolves the join and
-- denormalizes the rate onto the row so CallBoard never has to reach the
-- on-prem ERP at request time.
--
-- Usage is DISPLAY-ONLY: estimates and work orders show Subtotal / Sales Tax /
-- Total so the customer sees the real total. The stored billing_amount that
-- flows to Synergy stays PRE-TAX — Synergy remains authoritative and applies
-- the actual tax when the invoice is keyed (no double-counting).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(7,4),                    -- jurisdiction percent, e.g. 7.7500
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT false, -- Synergy TaxType = 2
  ADD COLUMN IF NOT EXISTS tax_code INTEGER,                        -- Synergy cust.TaxCode (audit/traceability)
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT,                   -- taxcode.Desc, e.g. "JEFFERSON CO AL"
  ADD COLUMN IF NOT EXISTS tax_exempt_cert TEXT;                    -- Synergy cust.TaxExemp (exemption cert #)
