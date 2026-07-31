-- Migration 148: extend STILL-OPEN equipment-sale lead windows from 90 to 180 days
--
-- Companion to the EQUIPMENT_SALE_WINDOW_DAYS 90 -> 180 change in
-- src/lib/tech-leads/bonus-tiers.ts. That constant is only read at INSERT, where it
-- is stamped onto tech_leads.expires_at, so changing it does nothing for leads that
-- already exist. Without this, a lead submitted the week before the change still
-- dies at 90 days under a rule that has been replaced.
--
-- Caleb's ruling 2026-07-31: fix forward, do not retro. This migration honors that.
--   - It touches ONLY leads that have not expired yet (expires_at > now()).
--   - It resurrects nothing. The one already-'expired' lead stays expired.
--   - It recalculates no bonus and pays nobody for the past.
--   - Terminal states (earned, paid, rejected, cancelled, expired) are untouched.
--
-- Expected effect at authoring time (prod, 2026-07-31): 15 rows.
--
-- >>> TIME-SENSITIVE. <<<
-- The `expires_at > now()` guard is what makes this safe, and it is also what makes
-- it decay: every lead that hits its 90-day mark before this runs falls out of scope
-- permanently and cannot be recovered without a retro change Caleb has declined.
-- Apply promptly. If this sits for weeks, re-count before assuming it still saves 15.
--
-- Idempotent: re-running recomputes the same submitted_at + 180d for rows still in
-- scope, and silently skips anything that has since expired.

UPDATE tech_leads
SET    expires_at = submitted_at + interval '180 days'
WHERE  lead_type  = 'equipment_sale'
  AND  status IN ('pending', 'approved', 'match_pending')
  AND  expires_at IS NOT NULL
  AND  expires_at > now()
  AND  submitted_at + interval '180 days' > expires_at;   -- never shorten a window
