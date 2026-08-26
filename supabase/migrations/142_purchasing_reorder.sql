-- Migration 142: Purchasing / Reorder Module (P1 — data model)
--
-- Adds the `purchasing` role and the six tables backing the Whse-4 reorder
-- walk: three read-only synced inventory tables (inv_reorder, inv_vendors,
-- inv_bins) populated by an extension of scripts/sync/synergy-sync.py, and
-- three session tables (reorder_sessions, reorder_lines,
-- reorder_session_vendors) holding the purchasing agent's walk/review/PO work.
-- See docs/superpowers/specs/2026-07-14-purchasing-reorder-module-design.md
-- ("Data Model" section) for the full design.
--
-- Apply via the repo's normal path (Supabase SQL editor / MCP / CLI); do not
-- auto-apply. After applying, run `npm run check:migrations` to confirm no
-- drift.

-- ============================================================
-- Step 1: add the `purchasing` role (drop/re-add, per 023b)
-- ============================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'manager', 'coordinator', 'technician', 'purchasing'));

-- ============================================================
-- Step 2: synced inventory tables (read-only from the app; the nightly
-- sync writes these via the service role, which bypasses RLS)
-- ============================================================

-- inv_vendors — vendor master (a80vm)
CREATE TABLE IF NOT EXISTS inv_vendors (
  vendor_code   INTEGER PRIMARY KEY,                  -- a80vm.VendorCode
  name          VARCHAR,                              -- a80vm.Name
  order_minimum DECIMAL(12,2),                        -- a80vm.MimimumOrderAmount
  terms_code    INTEGER,                              -- a80vm.Terms
  contact       VARCHAR,                              -- a80vm.Contact
  freight_code  VARCHAR,                              -- a80vm.FreightCode
  synced_at     TIMESTAMPTZ
);

-- inv_bins — product <-> bin (prodloc, Whse 4) for bin-label scan-to-jump
CREATE TABLE IF NOT EXISTS inv_bins (
  id                 BIGSERIAL PRIMARY KEY,
  synergy_product_id VARCHAR NOT NULL,                -- prodloc.ProdCode
  bin_location       VARCHAR NOT NULL,                -- prodloc.Loc
  is_primary         BOOLEAN DEFAULT FALSE,           -- prodloc.PermPrim
  sort_key           VARCHAR,                         -- parsed (mirrors bin-sort.ts)
  synced_at          TIMESTAMPTZ,
  UNIQUE (synergy_product_id, bin_location)
);

CREATE INDEX IF NOT EXISTS idx_inv_bins_bin ON inv_bins(bin_location);

-- inv_reorder — one row per Whse-4 stocking product (prod + prodwhse + upcxref)
CREATE TABLE IF NOT EXISTS inv_reorder (
  synergy_product_id VARCHAR PRIMARY KEY,             -- prod.ProdCode
  description        VARCHAR,                         -- Desc1 + Desc2
  commodity_code     VARCHAR,                         -- prod.ComdtyCode
  buying_uom         VARCHAR,                         -- decoded from prod.UMVendOrd
  stock_uom          VARCHAR,                         -- decoded from prod.UMStkDefault
  pack_size          VARCHAR,                         -- prod.PackSize ("12/CS")
  pack_qty           INTEGER,                         -- eaches per buying UOM (derived)
  qty_on_hand        INTEGER,                         -- prodwhse.QtyOnHand
  qty_on_po          INTEGER,                         -- prodwhse.QtyOnPO (inbound)
  qty_committed      INTEGER,                         -- prodwhse.QtyOnOrd (outbound)
  qty_available       INTEGER,                        -- computed
  order_point        INTEGER,                         -- prodwhse.OrdPt
  min_stock          INTEGER,                         -- prodwhse.MinStkLvl
  max_stock          INTEGER,                         -- prodwhse.MaxStkLvl
  safety_stock       INTEGER,                         -- prodwhse.SafetyStkQty
  eoq                INTEGER,                         -- prodwhse.EOQOrdQty
  do_not_reorder     BOOLEAN DEFAULT FALSE,           -- prodwhse.DNReordFlg
  seasonal           BOOLEAN DEFAULT FALSE,           -- prodwhse.SeasonalFlag
  usage_rate         INTEGER,                         -- prodwhse.UsgRate
  demand             INTEGER,                         -- prodwhse.Demand
  period_usage       JSONB,                           -- [UnitSlsCurYear1..13]
  weekly_usage       DECIMAL(10,2),                   -- computed trailing avg
  last_sold_date     DATE,                            -- prodwhse.LastSoldDate
  avg_lead_time      DECIMAL(8,2),                    -- prodwhse.AvgLeadTime (units unconfirmed)
  unit_cost          DECIMAL(12,4),                   -- prod.CostPO / CostLoad
  vendor_code        INTEGER,                         -- prodwhse.Vend / prod.PrimVend
  vendor_item_number VARCHAR,                         -- prod.VendItem / prodwhse.VendPN
  primary_bin        VARCHAR,                         -- prodloc primary Loc
  bin_sort_key       VARCHAR,                         -- parsed walk-order key
  all_bins           VARCHAR,                         -- comma list incl. overflow
  barcode            VARCHAR,                         -- upcxref.UpcAltItem
  active             BOOLEAN DEFAULT TRUE,            -- false = dropped from latest pull
  synced_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_reorder_vendor  ON inv_reorder(vendor_code);
CREATE INDEX IF NOT EXISTS idx_inv_reorder_sort    ON inv_reorder(bin_sort_key);
CREATE INDEX IF NOT EXISTS idx_inv_reorder_barcode ON inv_reorder(barcode);

-- ============================================================
-- Step 3: session tables (the purchasing agent's walk/review/PO work)
-- ============================================================

CREATE TABLE IF NOT EXISTS reorder_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR NOT NULL,                  -- "Reorder walk — Jul 14"
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'walking', 'review', 'ordered', 'closed', 'canceled')),
  scope_type      TEXT NOT NULL DEFAULT 'all'
    CHECK (scope_type IN ('all', 'zone', 'vendor', 'below_rop')),
  scope_value     VARCHAR,                           -- zone/bin-prefix or vendor code; null for 'all'/'below_rop'
  created_by_id   UUID,
  inventory_as_of TIMESTAMPTZ,                        -- sync timestamp the walk was based on
  total_items     INTEGER DEFAULT 0,
  lines_ordered   INTEGER DEFAULT 0,
  est_total_cost  DECIMAL(12,2) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reorder_sessions_created_by_id_fkey
    FOREIGN KEY (created_by_id) REFERENCES users(id)
);

DROP TRIGGER IF EXISTS reorder_sessions_updated_at ON reorder_sessions;
CREATE TRIGGER reorder_sessions_updated_at
  BEFORE UPDATE ON reorder_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- reorder_lines — snapshotted from inv_reorder at walk time so the worksheet
-- is stable even if the next sync changes the master. No FK to inv_reorder
-- (deliberately: inv_reorder rows get replaced/marked inactive by the sync;
-- the snapshot must survive that).
CREATE TABLE IF NOT EXISTS reorder_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL,

  synergy_product_id VARCHAR NOT NULL,
  description        VARCHAR,
  vendor_code        INTEGER,                        -- PO grouping key
  vendor_name        VARCHAR,
  vendor_item_number VARCHAR,
  bin_location       VARCHAR,                        -- primary bin
  buying_uom         VARCHAR,                        -- e.g. CS
  pack_qty           INTEGER,                         -- eaches per buying UOM

  -- Decision snapshot (what the agent saw)
  qoh                INTEGER,
  on_order           INTEGER,                         -- inbound
  committed          INTEGER,                         -- outbound
  available          INTEGER,
  weekly_usage       DECIMAL(10,2),
  weeks_of_supply    DECIMAL(10,2),
  order_point        INTEGER,
  max_level          INTEGER,
  suggested_qty      INTEGER,                         -- in buying UOM (cases)
  unit_cost          DECIMAL(12,4),                   -- per stock UOM

  -- Agent input
  order_qty          INTEGER DEFAULT 0,               -- in buying UOM; 0 = nothing ordered
  line_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (line_status IN ('pending', 'ordered', 'skipped', 'flagged')),
  flag_note          TEXT,

  sort_key           VARCHAR,                         -- precomputed walk-order key
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reorder_lines_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES reorder_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reorder_lines_session ON reorder_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_reorder_lines_vendor  ON reorder_lines(session_id, vendor_code);
CREATE INDEX IF NOT EXISTS idx_reorder_lines_sort    ON reorder_lines(session_id, sort_key);

DROP TRIGGER IF EXISTS reorder_lines_updated_at ON reorder_lines;
CREATE TRIGGER reorder_lines_updated_at
  BEFORE UPDATE ON reorder_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- reorder_session_vendors — per-vendor PO tracking
CREATE TABLE IF NOT EXISTS reorder_session_vendors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL,
  vendor_code       INTEGER NOT NULL,
  vendor_name       VARCHAR,
  synergy_po_number VARCHAR,                          -- recorded back after PO is created
  po_recorded_at    TIMESTAMPTZ,
  line_count        INTEGER DEFAULT 0,
  subtotal          DECIMAL(12,2) DEFAULT 0,
  notes             TEXT,

  CONSTRAINT reorder_session_vendors_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES reorder_sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, vendor_code)
);

-- ============================================================
-- Step 4: RLS
-- ============================================================

-- inv_reorder / inv_vendors / inv_bins: SELECT only for super_admin/manager/
-- purchasing. No client insert/update/delete policy — the sync writes via the
-- service role, which bypasses RLS entirely.
ALTER TABLE inv_reorder ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_reorder_select ON inv_reorder;
CREATE POLICY inv_reorder_select ON inv_reorder
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS inv_vendors_select ON inv_vendors;
CREATE POLICY inv_vendors_select ON inv_vendors
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS inv_bins_select ON inv_bins;
CREATE POLICY inv_bins_select ON inv_bins
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

-- reorder_sessions / reorder_lines / reorder_session_vendors: full read/write
-- for super_admin/manager/purchasing; DELETE restricted to super_admin/manager
-- (a purchasing agent can't delete a session — matches "cannot delete others'
-- sessions" in the spec's Roles & Permissions).
ALTER TABLE reorder_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reorder_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE reorder_session_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reorder_sessions_select ON reorder_sessions;
CREATE POLICY reorder_sessions_select ON reorder_sessions
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_sessions_insert ON reorder_sessions;
CREATE POLICY reorder_sessions_insert ON reorder_sessions
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_sessions_update ON reorder_sessions;
CREATE POLICY reorder_sessions_update ON reorder_sessions
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_sessions_delete ON reorder_sessions;
CREATE POLICY reorder_sessions_delete ON reorder_sessions
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS reorder_lines_select ON reorder_lines;
CREATE POLICY reorder_lines_select ON reorder_lines
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_lines_insert ON reorder_lines;
CREATE POLICY reorder_lines_insert ON reorder_lines
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_lines_update ON reorder_lines;
CREATE POLICY reorder_lines_update ON reorder_lines
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_lines_delete ON reorder_lines;
CREATE POLICY reorder_lines_delete ON reorder_lines
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP POLICY IF EXISTS reorder_session_vendors_select ON reorder_session_vendors;
CREATE POLICY reorder_session_vendors_select ON reorder_session_vendors
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_session_vendors_insert ON reorder_session_vendors;
CREATE POLICY reorder_session_vendors_insert ON reorder_session_vendors
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_session_vendors_update ON reorder_session_vendors;
CREATE POLICY reorder_session_vendors_update ON reorder_session_vendors
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'purchasing'));

DROP POLICY IF EXISTS reorder_session_vendors_delete ON reorder_session_vendors;
CREATE POLICY reorder_session_vendors_delete ON reorder_session_vendors
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

-- ============================================================
-- Step 5: allow sync_type='inventory' on sync_log so the new
-- Whse-4 inventory feed can log its runs (drives SyncStatusBanner
-- freshness for the reorder walk). Widen the existing CHECK.
-- ============================================================

ALTER TABLE sync_log DROP CONSTRAINT IF EXISTS sync_log_sync_type_check;
ALTER TABLE sync_log ADD CONSTRAINT sync_log_sync_type_check
  CHECK (sync_type IN ('customers', 'contacts', 'products', 'full', 'inventory'));
