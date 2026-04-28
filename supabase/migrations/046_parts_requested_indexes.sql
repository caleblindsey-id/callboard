-- Migration 046: GIN indexes on parts_requested JSONB
-- See projects/callboard-qc/section-4-parts-order-queue.md (PQ-1) in the Compass repo.
--
-- The parts_order_queue view UNIONs both ticket tables and explodes each row's
-- parts_requested via jsonb_array_elements. Without an index on parts_requested,
-- every query on the view scans every row of both tables. GIN indexes let the
-- planner skip rows with empty/null arrays.

CREATE INDEX IF NOT EXISTS idx_pm_tickets_parts_requested
  ON pm_tickets USING GIN (parts_requested);

CREATE INDEX IF NOT EXISTS idx_service_tickets_parts_requested
  ON service_tickets USING GIN (parts_requested);
