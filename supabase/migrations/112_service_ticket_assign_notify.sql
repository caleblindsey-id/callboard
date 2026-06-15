-- Audit trail for the "you've been assigned a service ticket" tech notification.
-- Stamped by notifyTechOfAssignment after a successful send (create + reassign).
-- On reassignment these reflect the LATEST assignment notification for the ticket.
-- Mirrors the pickup_notified_at / pickup_notify_message_id pattern (migration 100).

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS assigned_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_notify_message_id TEXT;
