-- Migration 126: Manager approval for below-floor parts pricing
--
-- A part line normally can't be priced below the 15% gross-margin floor
-- (min price = loaded cost / 0.85), enforced server-side for everyone. A
-- manager (super_admin/manager) may now APPROVE a below-floor price down to
-- loaded cost (never below cost) by supplying a justification. These columns
-- record that approval: who approved, when, and the reason. Stamped
-- server-side only (not via the field allowlist), so they're set only when an
-- override is actually exercised. Nullable for the overwhelming majority of
-- tickets that never need an override. The generic audit_events trigger
-- (migration 058) captures the change automatically.

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS margin_override_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS margin_override_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS margin_override_note TEXT;

ALTER TABLE service_tickets
  DROP CONSTRAINT IF EXISTS service_tickets_margin_override_note_len;

ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_margin_override_note_len
    CHECK (margin_override_note IS NULL OR char_length(margin_override_note) <= 2000);
