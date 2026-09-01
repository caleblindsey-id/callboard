-- Automated follow-up for open credit reviews (feedback #75).
--
-- A credit review is emailed to AR once, at creation, and then never chased.
-- Production bore out the cost: three AR-blocked orders sat 60, 64 and 68 days
-- before a manager unblocked them. Pending reviews are fine (AR has never taken
-- more than 4.8 days) -- it is the blocked ones that rot.
--
-- These two columns let a daily cron re-nudge on a cadence without re-sending
-- every run: it selects rows whose last_reminded_at is older than the configured
-- interval, and reminder_count drives escalation (pending reviews copy managers
-- after two silent AR nudges).
--
-- Both are nullable/defaulted so existing rows need no backfill: a review that
-- has never been reminded has reminder_count 0 and last_reminded_at NULL, and
-- the cron's `last_reminded_at IS NULL OR last_reminded_at < cutoff` predicate
-- treats that as "due", which is the behaviour we want for the existing backlog.

alter table public.credit_reviews
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminded_at timestamptz;

comment on column public.credit_reviews.reminder_count is
  'Follow-up reminders sent for this review (feedback #75). Drives escalation: a pending review copies managers once this exceeds 2.';
comment on column public.credit_reviews.last_reminded_at is
  'When the last follow-up reminder was sent. NULL = never reminded, which the cron treats as due.';

-- The cron scans only open reviews, every day. A partial index keeps that scan
-- off a table that is overwhelmingly 'released' rows (112 of 112 in prod today).
create index if not exists credit_reviews_open_followup_idx
  on public.credit_reviews (status, last_reminded_at)
  where status in ('pending', 'blocked');
