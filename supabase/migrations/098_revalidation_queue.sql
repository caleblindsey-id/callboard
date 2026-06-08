-- Migration 098: On-demand Synergy re-check queue.
--
-- The Parts Queue "re-check" button used to spawn the Python validator
-- server-side (POST /api/parts-queue/[id]/revalidate -> spawn('python', ...)).
-- That only works when CallBoard runs ON the office workstation (Python + the
-- ERPlinked ODBC DSN + LAN access to Synergy). On the hosted Vercel deployment
-- there is no Python, so every click failed with "Failed to start validator".
--
-- New design: the cloud route ENQUEUES a request here; the office workstation
-- drains the queue every ~2 min (validate-synergy-orders.py --drain-queue),
-- runs the same single-ticket validation, and writes the result back. The UI
-- polls until the row flips to done/error.
--
-- Design ref: C:\Users\Caleb Lindsey\.claude\plans\tidy-giggling-ocean.md

-- ---------------------------------------------------------------------------
-- 1. revalidation_queue table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revalidation_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('pm','service')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','error')),
  requested_by  UUID REFERENCES users(id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  result        JSONB,
  error         TEXT
);

COMMENT ON TABLE revalidation_queue IS
  'On-demand Synergy re-check requests. The hosted app enqueues a row; the '
  'office workstation drains it (validate-synergy-orders.py --drain-queue) and '
  'writes status/result back. Service-role only (deny-all RLS) — all access is '
  'mediated by /api/parts-queue/[id]/revalidate (admin client) and the drain '
  'script (service-role key). Operational ephemera, not a business record.';

COMMENT ON COLUMN revalidation_queue.ticket_id IS
  'service_tickets.id or pm_tickets.id depending on source — not a hard FK '
  '(two possible parent tables).';

COMMENT ON COLUMN revalidation_queue.result IS
  'The validate_single() result dict echoed back by the drain script on '
  'success: { ok, synergy_validation_status, parts_validation_status, ... }.';

-- Dedupe: at most one in-flight request per ticket. Repeated clicks coalesce
-- onto the existing pending/processing row (route does ON CONFLICT DO NOTHING
-- then returns the live row).
CREATE UNIQUE INDEX IF NOT EXISTS revalidation_queue_one_inflight_idx
  ON revalidation_queue (ticket_id, source)
  WHERE status IN ('pending','processing');

-- Drain scan: oldest pending first.
CREATE INDEX IF NOT EXISTS revalidation_queue_pending_idx
  ON revalidation_queue (requested_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. RLS — deny-all. No client policies: the cloud route uses the service-role
--    admin client and the drain script uses the service-role key, both of
--    which bypass RLS. Enabling RLS with no policies makes any accidental
--    anon/authenticated direct access return zero rows instead of leaking.
-- ---------------------------------------------------------------------------
ALTER TABLE revalidation_queue ENABLE ROW LEVEL SECURITY;
