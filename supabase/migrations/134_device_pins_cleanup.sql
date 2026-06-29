-- One-time cleanup of orphaned quick-PIN rows.
--
-- Before the durable cb-did cookie, the device_id lived only in localStorage, which
-- iOS ITP evicts after ~7 idle days. Each eviction regenerated the id, so re-enrolling
-- stranded the old (device_id, user_id) row: a PIN that can never be used again because
-- no browser still holds that device_id. Fingerprint of a stranded row: it was never
-- once used for a successful login (last_used_at IS NULL).
--
-- Conservative sweep: delete only never-used rows older than 30 days. A recent never-
-- used row could be a brand-new enrollment not yet used, so it is preserved. Rows with
-- a non-null last_used_at (including the one legitimate row per shared shop device) are
-- never touched. The UNIQUE(device_id, user_id) constraint is unchanged.
-- Idempotent.
DELETE FROM device_pins
WHERE last_used_at IS NULL
  AND created_at < now() - interval '30 days';
