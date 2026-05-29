-- Soft-delete on service_tickets — parity with pm_tickets (migration 043).
-- Service tickets were hard-deleted, which permanently lost the work record and
-- could strand a vendor PO. Mirror the PM model: a deleted ticket survives in
-- the table (read-only, manager-restorable). App-layer queries filter
-- `deleted_at IS NULL`; techs never see deleted tickets.

ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS deleted_by_id UUID REFERENCES users(id);

-- Live tickets are the common case and the board narrows the live set by status,
-- so index (status) over only the non-deleted rows. Keeps the partial index small
-- while accelerating the default .is('deleted_at', null) board/list filters.
CREATE INDEX IF NOT EXISTS idx_service_tickets_live
  ON service_tickets (status)
  WHERE deleted_at IS NULL;
