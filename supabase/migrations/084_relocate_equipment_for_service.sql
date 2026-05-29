-- Migration 084: Tech-initiated equipment relocation on SERVICE tickets.
--
-- Parity with PM relocation (migration 049). Service tickets already have the
-- ship_to_location_id snapshot column, and equipment_location_history already
-- has the service_ticket_id FK (added in 049 in anticipation of this) — only
-- the RPC and the ship_to_requests link were missing.
--
-- Adds:
--   1. ship_to_requests.service_ticket_id — so a "request a new ship-to" raised
--      from a service ticket links back to it, mirroring pm_ticket_id.
--   2. relocate_equipment_for_service() — atomic relocate RPC mirroring
--      relocate_equipment_for_pm(). SECURITY DEFINER, service_role-only EXECUTE,
--      so the equipment_tech_field_lock trigger (migration 048) sees a NULL
--      auth.uid() and lets the equipment write through — the same deliberate
--      escape hatch the PM flow uses.

-- ---------------------------------------------------------------------------
-- 1. ship_to_requests.service_ticket_id
-- ---------------------------------------------------------------------------
ALTER TABLE ship_to_requests
  ADD COLUMN IF NOT EXISTS service_ticket_id UUID
    REFERENCES service_tickets(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. relocate_equipment_for_service — atomic relocate RPC
-- ---------------------------------------------------------------------------
-- Validations (each raises P0001):
--   - Service ticket exists, is live (deleted_at IS NULL), is not terminal
--     (completed / billed / declined / canceled).
--   - Ticket has linked equipment (inline-only equipment can't be relocated —
--     there's no equipment row to move).
--   - Target ship-to belongs to the SAME customer as the ticket.
--   - Target ship-to differs from the current equipment ship-to (no-op guard).
CREATE OR REPLACE FUNCTION relocate_equipment_for_service(
  p_service_ticket_id  UUID,
  p_to_ship_to_id      INTEGER,
  p_actor              UUID,
  p_note               TEXT DEFAULT NULL
)
RETURNS equipment_location_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment_id   UUID;
  v_ticket_status  TEXT;
  v_ticket_deleted TIMESTAMPTZ;
  v_ticket_cust    INT;
  v_target_cust    INT;
  v_from_ship_to   INTEGER;
  v_history        equipment_location_history;
BEGIN
  -- 1. Lookup ticket. Lock the row so concurrent relocates serialize.
  SELECT equipment_id, status, deleted_at, customer_id
    INTO v_equipment_id, v_ticket_status, v_ticket_deleted, v_ticket_cust
  FROM service_tickets
  WHERE id = p_service_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service ticket not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_ticket_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot relocate a deleted service ticket' USING ERRCODE = 'P0001';
  END IF;

  IF v_ticket_status IN ('completed','billed','declined','canceled') THEN
    RAISE EXCEPTION 'Cannot relocate equipment on a % service ticket', v_ticket_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_equipment_id IS NULL THEN
    RAISE EXCEPTION 'Service ticket has no linked equipment to relocate' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Validate target ship-to belongs to the same customer.
  SELECT customer_id INTO v_target_cust
  FROM ship_to_locations
  WHERE id = p_to_ship_to_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target ship-to not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_target_cust IS DISTINCT FROM v_ticket_cust THEN
    RAISE EXCEPTION 'Target ship-to belongs to a different customer'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Capture current equipment ship-to (for history "from").
  SELECT ship_to_location_id INTO v_from_ship_to
  FROM equipment
  WHERE id = v_equipment_id
  FOR UPDATE;

  IF v_from_ship_to IS NOT DISTINCT FROM p_to_ship_to_id THEN
    RAISE EXCEPTION 'Equipment is already at this ship-to' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Stamp the service ticket snapshot. (RLS bypassed — running as owner.)
  UPDATE service_tickets
  SET ship_to_location_id = p_to_ship_to_id,
      updated_at = now()
  WHERE id = p_service_ticket_id;

  -- 5. Update equipment home location. The equipment_tech_field_lock trigger
  --    short-circuits when get_user_role() is NULL (service-role context).
  UPDATE equipment
  SET ship_to_location_id = p_to_ship_to_id,
      updated_at = now()
  WHERE id = v_equipment_id;

  -- 6. Audit row.
  INSERT INTO equipment_location_history (
    equipment_id, from_ship_to_id, to_ship_to_id,
    changed_by, service_ticket_id, note
  )
  VALUES (
    v_equipment_id, v_from_ship_to, p_to_ship_to_id,
    p_actor, p_service_ticket_id, NULLIF(BTRIM(p_note), '')
  )
  RETURNING * INTO v_history;

  RETURN v_history;
END;
$$;

-- Lock down execution — same posture as relocate_equipment_for_pm.
REVOKE ALL ON FUNCTION relocate_equipment_for_service(UUID, INTEGER, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION relocate_equipment_for_service(UUID, INTEGER, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION relocate_equipment_for_service(UUID, INTEGER, UUID, TEXT) TO service_role;
