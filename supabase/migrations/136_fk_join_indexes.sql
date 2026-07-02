-- 136_fk_join_indexes.sql
--
-- (audit 2026-07-01, performance advisor) Two unindexed foreign keys that are
-- real join keys on hot paths — every customer→ship-to and equipment→ship-to
-- lookup scanned without them. Deliberately NOT indexing the rest of the 63
-- unindexed FKs the advisor flagged: the others are audit-trail columns
-- (created_by_id, updated_by_id, *_resolved_by_id, margin_override_by, etc.)
-- that are never used as filters or join keys, so an index there would only add
-- write overhead — the same anti-pattern behind the advisor's unused_index
-- warnings.
--
--   - ship_to_locations.customer_id — customer → ship-to fan-out is used across
--     billing, pickup, provisional reconciliation, and every ship-to picker.
--   - equipment.ship_to_location_id — equipment → ship-to join in the billing,
--     pickup, and PM/service ticket queries (ship_to_locations(...) embeds).

CREATE INDEX IF NOT EXISTS idx_ship_to_locations_customer_id
  ON public.ship_to_locations (customer_id);

CREATE INDEX IF NOT EXISTS idx_equipment_ship_to_location_id
  ON public.equipment (ship_to_location_id);
