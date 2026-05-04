-- Migration 056: Customer auto-approve threshold
--
-- Adds a per-customer threshold for automatic estimate approval. When a service
-- ticket estimate is submitted and the total is strictly less than the customer's
-- threshold, the ticket skips 'estimated' and lands directly in 'approved'.
--
-- $0 means never auto-approve (always require customer approval).
-- Default $100 preserves the previous hardcoded behavior.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS auto_approve_threshold numeric NOT NULL DEFAULT 100
    CHECK (auto_approve_threshold >= 0);
