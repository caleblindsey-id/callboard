-- Audit trail for the "notify managers on tech lead submission" email.
-- Set non-fatally by POST /api/tech-leads after the Mandrill send succeeds.
ALTER TABLE tech_leads
  ADD COLUMN IF NOT EXISTS submit_notified_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submit_notify_message_id TEXT;
