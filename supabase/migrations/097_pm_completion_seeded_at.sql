-- Guard for the completion-form parts seed (covered/billable pre-population from
-- received parts_requested). The form seeds pmParts/additionalParts ONLY on a
-- ticket that has never been drafted; once the tech first auto-saves, the saved
-- draft becomes the source of truth. Without a persisted "has been seeded"
-- sentinel, a fresh ticket ([]) and a tech-emptied draft ([]) are
-- indistinguishable, so a deleted (un-billed) part would silently re-seed and
-- re-bill the customer on reopen.
--
-- completion_seeded_at is stamped on the first completion auto-save (NULL = the
-- form has never been opened/saved → seed from requested parts; non-NULL → the
-- saved parts_used/additional_parts_used win).

ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS completion_seeded_at timestamptz;

-- Backfill: existing tickets pre-date the column, so they'd all read NULL and
-- re-seed on next open — clobbering any draft already entered. Stamp every
-- ticket that already shows completion work (saved parts, or a terminal status)
-- so the saved parts_used/additional_parts_used stay authoritative. Tickets
-- with no saved parts and a live status stay NULL and seed from requested parts
-- on first open (the intended new behavior).
UPDATE pm_tickets
SET completion_seeded_at = COALESCE(completed_date::timestamptz, updated_at)
WHERE completion_seeded_at IS NULL
  AND (
    jsonb_array_length(COALESCE(parts_used, '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(additional_parts_used, '[]'::jsonb)) > 0
    OR status IN ('completed', 'billed', 'skipped', 'skip_requested')
  );
