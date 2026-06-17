-- Tech shop-supply requests. A technician asks the warehouse/office to pull
-- general shop consumables (WD-40, grease, gloves, wipers, shop towels, etc.).
-- These are NOT customer-billable parts on a job, so they live in their own
-- standalone table rather than inside a ticket's parts JSONB. The office sees a
-- worklist, pulls the items, marks them ready, and the tech picks them up.
--
-- Lifecycle: pending -> ready -> picked_up, with a denied branch.
-- Fulfillment is done by office staff (super_admin/manager/coordinator);
-- CallBoard has no separate "warehouse" role.

-- ------------------------------------------------------------------
-- supply_catalog — the manager-editable quick-pick list shown to techs.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_catalog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  unit        TEXT,                                  -- e.g. "can", "pair", "box", "roll"
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supply_catalog_active ON supply_catalog(active, sort_order);

ALTER TABLE supply_catalog ENABLE ROW LEVEL SECURITY;

-- Every authenticated user can read the list (techs need it for the request form).
DROP POLICY IF EXISTS supply_catalog_read ON supply_catalog;
CREATE POLICY supply_catalog_read ON supply_catalog
  FOR SELECT TO authenticated USING (true);

-- Only office staff manage the catalog (writes come in Round 3's Settings UI).
DROP POLICY IF EXISTS supply_catalog_staff_insert ON supply_catalog;
CREATE POLICY supply_catalog_staff_insert ON supply_catalog
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

DROP POLICY IF EXISTS supply_catalog_staff_update ON supply_catalog;
CREATE POLICY supply_catalog_staff_update ON supply_catalog
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

DROP POLICY IF EXISTS supply_catalog_staff_delete ON supply_catalog;
CREATE POLICY supply_catalog_staff_delete ON supply_catalog
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager'));

DROP TRIGGER IF EXISTS supply_catalog_updated_at ON supply_catalog;
CREATE TRIGGER supply_catalog_updated_at
  BEFORE UPDATE ON supply_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed a starter set so the feature works day one. Managers can edit later.
INSERT INTO supply_catalog (name, unit, sort_order)
SELECT * FROM (VALUES
  ('WD-40',                'can',  10),
  ('White lithium grease', 'can',  20),
  ('Nitrile gloves',       'box',  30),
  ('Shop towels / wipers', 'roll', 40),
  ('Brake cleaner',        'can',  50),
  ('Zip ties',             'bag',  60),
  ('Electrical tape',      'roll', 70),
  ('Paper towels',         'roll', 80)
) AS seed(name, unit, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM supply_catalog);

-- ------------------------------------------------------------------
-- supply_requests — one row per request a tech submits.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by    UUID NOT NULL,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, quantity, catalog_id?, unit? }]
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ready', 'picked_up', 'denied')),
  denied_reason   TEXT,
  ready_at        TIMESTAMPTZ,
  ready_by        UUID,
  ready_notified_at TIMESTAMPTZ,                        -- dedup anchor for the "ready" notice (Round 2)
  picked_up_at    TIMESTAMPTZ,
  picked_up_by    UUID,
  denied_at       TIMESTAMPTZ,
  denied_by       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supply_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT supply_requests_ready_by_fkey     FOREIGN KEY (ready_by)     REFERENCES users(id),
  CONSTRAINT supply_requests_picked_up_by_fkey FOREIGN KEY (picked_up_by) REFERENCES users(id),
  CONSTRAINT supply_requests_denied_by_fkey    FOREIGN KEY (denied_by)    REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_supply_requests_requested_by ON supply_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_supply_requests_status ON supply_requests(status);

ALTER TABLE supply_requests ENABLE ROW LEVEL SECURITY;

-- A tech creates and reads only their own requests.
DROP POLICY IF EXISTS supply_requests_tech_insert ON supply_requests;
CREATE POLICY supply_requests_tech_insert ON supply_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'technician'
    AND requested_by = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS supply_requests_tech_select ON supply_requests;
CREATE POLICY supply_requests_tech_select ON supply_requests
  FOR SELECT TO authenticated
  USING (get_user_role() = 'technician' AND requested_by = auth.uid());

-- A tech may cancel (delete) their own request only while it is still pending.
-- No tech UPDATE policy: techs never edit a submitted request, and withholding
-- UPDATE prevents a tech from self-marking their own request ready.
DROP POLICY IF EXISTS supply_requests_tech_delete ON supply_requests;
CREATE POLICY supply_requests_tech_delete ON supply_requests
  FOR DELETE TO authenticated
  USING (get_user_role() = 'technician' AND requested_by = auth.uid() AND status = 'pending');

-- Office staff see and manage every request.
DROP POLICY IF EXISTS supply_requests_staff_select ON supply_requests;
CREATE POLICY supply_requests_staff_select ON supply_requests
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

DROP POLICY IF EXISTS supply_requests_staff_update ON supply_requests;
CREATE POLICY supply_requests_staff_update ON supply_requests
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

DROP TRIGGER IF EXISTS supply_requests_updated_at ON supply_requests;
CREATE TRIGGER supply_requests_updated_at
  BEFORE UPDATE ON supply_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
