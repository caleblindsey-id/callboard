-- 127_provisional_records.sql
-- Same-day customer / ship-to entry that auto-reconciles on the nightly Synergy sync.
--
-- CallBoard reads customers/ship-tos from a Supabase cache populated by a nightly
-- sync (synergy-sync.py), which itself reads a nightly Synergy MySQL replica. So a
-- customer or ship-to created in Synergy today is not selectable in CallBoard until
-- the next morning. The office always creates the record in Synergy first, so a real
-- Synergy code exists same-day. A "provisional" row is created in-app keyed on that
-- real code (CustomerCode / ShiplistCode) so work proceeds immediately. The next
-- nightly sync upserts on the Synergy key, fills the remaining fields, and flips
-- provisional -> false. No fuzzy matching or merge logic is needed.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provisional_created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS provisional_created_at TIMESTAMPTZ;

ALTER TABLE ship_to_locations
  ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provisional_created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS provisional_created_at TIMESTAMPTZ;

-- Partial indexes — cheap lookups of the (normally tiny) set of still-pending rows,
-- e.g. for a future "provisional records pending > N days" worklist.
CREATE INDEX IF NOT EXISTS idx_customers_provisional
  ON customers (provisional) WHERE provisional;
CREATE INDEX IF NOT EXISTS idx_ship_to_locations_provisional
  ON ship_to_locations (provisional) WHERE provisional;
