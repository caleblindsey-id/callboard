-- Migration 087: Equipment details verified flag.
--
-- Equipment make/model/serial are optional at ticket creation (the office often
-- takes a call without the unit in front of them). To stop low-quality equipment
-- records from accumulating, a technician must enter (if missing) or verify (if
-- present) the make/model/serial before a service or PM ticket can be completed.
--
-- This is a verify-once model: once a tech stamps the unit, future completions
-- trust it and don't re-prompt. These two columns hold that stamp.
--
-- The write path is the new POST /api/equipment/[id]/verify endpoint, which runs
-- under the service-role admin client. The existing tech-field-lock trigger
-- (migration 048, restrict_tech_equipment_updates) still blocks direct technician
-- writes to make/model/serial — it gates on get_user_role() = 'technician', and
-- under the admin client auth.uid() is NULL so that branch is skipped. No trigger
-- change is needed here.

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS details_verified_at TIMESTAMPTZ;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS details_verified_by UUID REFERENCES users(id);

COMMENT ON COLUMN equipment.details_verified_at IS
  'When a technician last confirmed this unit''s make/model/serial against the physical equipment. NULL = never verified; ticket completion prompts the tech until it is set. See migration 087 and /api/equipment/[id]/verify.';
COMMENT ON COLUMN equipment.details_verified_by IS
  'The user (technician) who last verified this unit''s identifying details.';
