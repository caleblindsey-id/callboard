-- Migration 039: Tech Lead Bonus V2 — Equipment Sale Program
--
-- Activates the second bonus program reserved by V1 (lead_type='equipment_sale').
-- When a tech flags aging equipment at a customer and we later sell the
-- replacement, the tech earns a tiered bonus:
--
--   ride_on_scrubber     $200
--   walk_behind_scrubber $100
--   hot_water_pw         $100
--   cold_water_pw        $ 25
--   cord_electric        $ 25   (excludes vacuums, fans, <10gal extractors)
--
-- Mechanism: nightly script scans Synergy `roh`/`rolnew` filtered by
-- `prod.ComdtyCode IN ('E400','E401')` for sales to flagged customers within
-- the 90-day window; each qualifying order becomes a candidate in
-- `equipment_sale_lead_candidates`. Manager opens /tech-leads Match Candidates
-- tab, confirms the match + picks the tier (pre-filled with tech's guess).
-- Confirmation atomically: candidate -> confirmed, siblings -> dismissed,
-- lead -> earned with bonus_amount locked from the tier lookup.

-- =================================================================
-- 1. tech_leads — new columns for the equipment-sale branch
-- =================================================================

ALTER TABLE tech_leads
  ADD COLUMN proposed_equipment_tier TEXT
    CHECK (proposed_equipment_tier IS NULL OR proposed_equipment_tier IN
      ('ride_on_scrubber', 'walk_behind_scrubber', 'hot_water_pw', 'cold_water_pw', 'cord_electric')),
  ADD COLUMN sale_equipment_tier TEXT
    CHECK (sale_equipment_tier IS NULL OR sale_equipment_tier IN
      ('ride_on_scrubber', 'walk_behind_scrubber', 'hot_water_pw', 'cold_water_pw', 'cord_electric')),
  ADD COLUMN sale_synergy_order_number INTEGER,
  ADD COLUMN expires_at TIMESTAMPTZ;

-- Expand status check to include match_pending + expired.
ALTER TABLE tech_leads DROP CONSTRAINT tech_leads_status_check;
ALTER TABLE tech_leads ADD CONSTRAINT tech_leads_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'cancelled',
    'earned', 'paid',
    'match_pending', 'expired'
  ));

-- Equipment-sale leads MUST have proposed_equipment_tier; PM leads MUST NOT.
-- equipment_description stays NOT NULL but equipment-sale inserts use the tier
-- label as the description for backward-compat with V1 queries.
ALTER TABLE tech_leads ADD CONSTRAINT tech_leads_equipment_sale_tier_chk CHECK (
  (lead_type <> 'equipment_sale')
  OR (lead_type = 'equipment_sale' AND proposed_equipment_tier IS NOT NULL)
);

-- Helpful indexes for the nightly scan + match-candidates queue
CREATE INDEX idx_tech_leads_open_equipment_sale
  ON tech_leads(expires_at)
  WHERE lead_type = 'equipment_sale' AND status IN ('approved', 'match_pending');

CREATE INDEX idx_tech_leads_expires_at
  ON tech_leads(expires_at)
  WHERE expires_at IS NOT NULL;

-- =================================================================
-- 2. equipment_sale_lead_candidates — one row per detected Synergy order
-- =================================================================

CREATE TABLE equipment_sale_lead_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tech_lead_id UUID NOT NULL,
  CONSTRAINT equipment_sale_lead_candidates_tech_lead_id_fkey
    FOREIGN KEY (tech_lead_id) REFERENCES tech_leads(id) ON DELETE CASCADE,

  synergy_order_number INTEGER NOT NULL,
  synergy_order_date   DATE NOT NULL,
  synergy_order_total  DECIMAL(10, 2),

  -- [{prod_code, description, qty, unit_price, comdty_code}, ...]
  -- Equipment lines only (E400/E401 after V175 exclusion).
  order_lines JSONB NOT NULL DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'dismissed')),

  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT equipment_sale_lead_candidates_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Nightly idempotency: one row per (lead, order) pair.
CREATE UNIQUE INDEX idx_equipment_sale_lead_candidates_unique
  ON equipment_sale_lead_candidates(tech_lead_id, synergy_order_number);

CREATE INDEX idx_equipment_sale_lead_candidates_tech_lead_id
  ON equipment_sale_lead_candidates(tech_lead_id);

CREATE INDEX idx_equipment_sale_lead_candidates_pending
  ON equipment_sale_lead_candidates(tech_lead_id)
  WHERE status = 'pending';

-- =================================================================
-- 3. RLS on equipment_sale_lead_candidates
-- =================================================================

ALTER TABLE equipment_sale_lead_candidates ENABLE ROW LEVEL SECURITY;

-- Staff read: super_admin + manager + coordinator (read-only for coordinator).
CREATE POLICY equipment_sale_lead_candidates_staff_select ON equipment_sale_lead_candidates
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

-- Staff write: super_admin + manager only.
CREATE POLICY equipment_sale_lead_candidates_staff_update ON equipment_sale_lead_candidates
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager'));

-- No INSERT policy — candidates are written only by the nightly script via the
-- service-role key. Supabase lets the service role bypass RLS by default, so no
-- staff-facing INSERT policy is needed. If we ever want staff to hand-add a
-- candidate, add an INSERT policy here.

-- Super_admin can hard-delete for cleanup.
CREATE POLICY equipment_sale_lead_candidates_super_admin_delete ON equipment_sale_lead_candidates
  FOR DELETE USING (get_user_role() = 'super_admin');

-- Techs never see candidates (no policy = no access).

COMMENT ON TABLE equipment_sale_lead_candidates IS
  'Synergy equipment-sale orders detected for open equipment_sale tech leads. Populated nightly by scan-equipment-sale-candidates.py; one row per (lead, Synergy order). Manager confirms or dismisses from /tech-leads Match Candidates tab.';

COMMENT ON COLUMN tech_leads.expires_at IS
  'Equipment-sale leads expire 90 days after submit. Set by API route on insert; sweep in nightly scan flips stale leads to status=expired.';
