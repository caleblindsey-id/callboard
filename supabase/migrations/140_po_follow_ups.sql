-- Structured per-PO follow-up log: tracks the coordinator's outreach to collect
-- a customer PO on a completed service ticket (who was contacted, how, and when).
-- Replaces the handwritten notes / emails the office used to track "who's been
-- called for the PO and how long it's been." Powers the Waiting-on-PO worklist.
--
-- Distinct from customer_notes (076): per-TICKET and structured (method enum),
-- not per-customer free text — which is why the free-text log never replaced the
-- handwritten tracking.
CREATE TABLE po_follow_ups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('call', 'email', 'text', 'other')),
  note         TEXT,
  contacted_by UUID NOT NULL REFERENCES users(id),
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_follow_ups_ticket_id ON po_follow_ups(ticket_id);

ALTER TABLE po_follow_ups ENABLE ROW LEVEL SECURITY;

-- Read for any authenticated user (the consuming worklist is manager-gated).
CREATE POLICY "Authenticated read po_follow_ups"
  ON po_follow_ups FOR SELECT TO authenticated USING (true);

-- Insert: the author must be the caller AND a manager role. Mirrors the
-- hardened customer_notes INSERT policy (post-135/139) — belt-and-suspenders
-- with the POST route's MANAGER_ROLES check. auth.uid() wrapped in a subquery
-- per the initplan fix (138).
CREATE POLICY "Authenticated insert po_follow_ups"
  ON po_follow_ups FOR INSERT TO authenticated
  WITH CHECK (
    contacted_by = (SELECT auth.uid())
    AND get_user_role() = ANY (ARRAY['super_admin', 'manager', 'coordinator'])
  );

-- Denormalized recency stamps for cheap worklist sort/display ("3d ago · call").
-- Maintained by the follow-up POST route alongside each insert; the log table is
-- the source of truth for full history.
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS po_last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_last_method TEXT;

COMMENT ON COLUMN service_tickets.po_last_contacted_at IS
  'Most recent po_follow_ups.contacted_at for this ticket; drives the Waiting-on-PO worklist recency. Maintained by the follow-up POST route.';
COMMENT ON COLUMN service_tickets.po_last_method IS
  'Method of the most recent po_follow_ups entry (call/email/text/other). Denormalized for the worklist row. Maintained by the follow-up POST route.';
