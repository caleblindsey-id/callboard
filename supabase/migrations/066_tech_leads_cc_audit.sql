-- Migration 066: Audit CC recipients on the approve-and-email send.
--
-- emailed_to_rep_id already records the primary recipient. emailed_cc_ids
-- records who got the CC, as an array of sales_reps.id strings. JSONB so we
-- can keep it on the row instead of standing up a junction table — the list
-- is short (≤10) and read together with the rest of the lead audit.

ALTER TABLE tech_leads
  ADD COLUMN emailed_cc_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tech_leads.emailed_cc_ids IS
  'Array of sales_reps.id strings CC''d on the approve-and-email send. Empty array when none.';
