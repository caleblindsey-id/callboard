-- 146: backfill service_tickets.parts_received onto one "fulfilled" rule
--
-- "Are this ticket's parts in?" was computed three different ways (feedback #79):
--   src/lib/parts.ts partsOnOrder()          → from_stock counts as fulfilled
--   api/parts-queue/update/route.ts:493-497  → from_stock counts as fulfilled
--   api/service-tickets/[id]/route.ts:985    → from_stock did NOT count   ← drift
--
-- and a ticket whose every live part was cancelled stayed parts_received = false
-- forever, because the old rule required live.length > 0 before it could be true.
--
-- The code now shares partsAllFulfilled() in src/lib/parts.ts:
--   live      = parts where NOT cancelled
--   fulfilled = every live part is 'received' or 'from_stock'
--               (vacuously true when nothing is live — that is the point)
--
-- This statement brings rows written under the old rules onto that rule.
--
-- Rows with an empty parts_requested are deliberately NOT touched. The board's
-- ready predicate carries them via `OR parts_requested = '[]'`, and flipping a
-- ticket that never had parts to parts_received = true would overstate what the
-- column means.
--
-- Soft-deleted rows ARE included: deletion is reversible here, and a restored
-- ticket should come back with a correct column rather than a stale one.
--
-- Idempotent — re-running updates zero rows.

UPDATE service_tickets
SET parts_received = true
WHERE parts_received = false
  AND jsonb_array_length(COALESCE(parts_requested, '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(parts_requested, '[]'::jsonb)) AS p
    WHERE COALESCE((p->>'cancelled')::boolean, false) = false
      AND p->>'status' NOT IN ('received', 'from_stock')
  );
