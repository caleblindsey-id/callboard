-- Migration 154: re-anchor backfilled pm_tickets.billed_at to Central midnight
--
-- Companion to the Central-anchored month windows in src/lib/business-time.ts.
-- Fixing the CODE without this migration would move 11 prod rows into the WRONG
-- month, so the two must ship together.
--
-- ---------------------------------------------------------------------------
-- What went wrong
-- ---------------------------------------------------------------------------
-- Migration 141 backfilled history with:
--
--     UPDATE pm_tickets SET billed_at = completed_date::timestamptz
--
-- `completed_date` is a DATE. Casting a DATE to timestamptz resolves it in the
-- SESSION timezone, and Supabase sessions are UTC, so a PM completed on
-- 2026-05-01 was stored as 2026-05-01T00:00:00Z. Read back in America/Chicago
-- that is 2026-04-30 19:00 -- the WRONG CALENDAR DAY, and when the date is the
-- 1st of a month, the wrong MONTH.
--
-- (service_tickets is unaffected: it backfilled from completed_at, which is a
-- real timestamptz, not a date. Verified 0 affected rows on prod.)
--
-- ---------------------------------------------------------------------------
-- Why this was invisible until now
-- ---------------------------------------------------------------------------
-- The Invoiced archive also bucketed months in UTC, so a UTC-anchored value read
-- through a UTC-anchored window landed in the right month by accident. Two bugs
-- cancelling. Fixing only the window would have surfaced the data bug as 11
-- tickets jumping a month; fixing only the data would have surfaced the window
-- bug the same way. Hence one migration plus one code change, together.
--
-- Blast radius measured on prod 2026-07-31, BEFORE this ran:
--   296 of 455 billed PM tickets carry the artifact (wrong calendar day)
--   11 of those sit on the 1st of a month (wrong month as well)
--   0 service tickets affected
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- Re-anchor to MIDNIGHT CENTRAL on the intended calendar day. `billed_at` means
-- "when this was invoiced" and for backfilled rows we only ever knew the date,
-- so midnight is the honest representation of a date-only value. After this,
-- both the calendar day and the month read correctly in America/Chicago.
--
-- Targeted narrowly: only rows still holding EXACTLY the artifact value. A row
-- whose billed_at was stamped by a real status->billed transition since 141 is
-- untouched, because a genuine stamp landing on exactly 00:00:00.000000Z is not
-- realistically possible. Idempotent: after this runs the predicate no longer
-- matches, so re-running is a no-op.
--
-- Forward-only. New rows are stamped with now() at the transition, which is an
-- unambiguous instant and needs no anchoring.

UPDATE pm_tickets
SET    billed_at = (completed_date::text || ' 00:00:00')::timestamp
                     AT TIME ZONE 'America/Chicago'
WHERE  billed_at IS NOT NULL
  AND  completed_date IS NOT NULL
  AND  billed_at = completed_date::timestamptz;

COMMENT ON COLUMN pm_tickets.billed_at IS
  'When the ticket was marked billed (invoiced). Stamped with now() at the status->billed '
  'transition. Rows predating migration 141 were backfilled from completed_date and '
  're-anchored by migration 154 to MIDNIGHT AMERICA/CHICAGO, because the original '
  'backfill cast a DATE in a UTC session and landed every such row on the previous '
  'calendar day. Month bucketing must use src/lib/business-time.ts, never a UTC '
  'month boundary.';
