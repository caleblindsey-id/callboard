-- Migration 100: Service Ticket "Ready for Pickup" tracking
-- Adds custody / notification / aging columns to service_tickets so an invoiced
-- (billed) INSIDE/bench repair becomes a tracked ready-for-pickup item. All adds
-- are nullable and non-breaking; later rounds (email, CSR call queue, re-notify,
-- abandonment) are pure app code on top of these columns.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS ready_for_pickup_at        TIMESTAMPTZ,   -- aging clock (set when staged)
  ADD COLUMN IF NOT EXISTS picked_up_by_name          VARCHAR,       -- who collected the unit
  ADD COLUMN IF NOT EXISTS released_by_id             UUID,          -- staff who released it (server-set)
  ADD COLUMN IF NOT EXISTS shop_location              VARCHAR,       -- shelf / bin in the shop
  ADD COLUMN IF NOT EXISTS pickup_notified_at         TIMESTAMPTZ,   -- first customer notification
  ADD COLUMN IF NOT EXISTS pickup_notify_message_id   TEXT,          -- Mandrill message id
  ADD COLUMN IF NOT EXISTS pickup_notify_channel      TEXT,          -- 'email' | 'phone'
  ADD COLUMN IF NOT EXISTS pickup_notify_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_last_notified_at    TIMESTAMPTZ,   -- re-notify cadence anchor
  ADD COLUMN IF NOT EXISTS pickup_called_at           TIMESTAMPTZ,   -- CSR phone-call log
  ADD COLUMN IF NOT EXISTS pickup_called_by_id        UUID,          -- CSR who called
  ADD COLUMN IF NOT EXISTS pickup_call_notes          TEXT,
  ADD COLUMN IF NOT EXISTS abandonment_notice_sent_at TIMESTAMPTZ;

-- Named CHECK + FKs, matching the 027 PostgREST-friendly convention.
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_pickup_notify_channel_chk
    CHECK (pickup_notify_channel IS NULL OR pickup_notify_channel IN ('email','phone'));

ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_released_by_id_fkey
    FOREIGN KEY (released_by_id) REFERENCES users(id);

ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_pickup_called_by_id_fkey
    FOREIGN KEY (pickup_called_by_id) REFERENCES users(id);

-- Partial index drives the pickup queue + (R4) the re-notify scanner cheaply.
CREATE INDEX IF NOT EXISTS idx_service_tickets_awaiting_pickup
  ON service_tickets(ready_for_pickup_at)
  WHERE awaiting_pickup = true AND picked_up_at IS NULL;

-- Backfill any in-flight units so the aging clock isn't NULL on day one.
UPDATE service_tickets
  SET ready_for_pickup_at = COALESCE(updated_at, now())
  WHERE awaiting_pickup = true AND picked_up_at IS NULL AND ready_for_pickup_at IS NULL;
