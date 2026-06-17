-- Migration 122: track the 2026-06-17 autovacuum tuning + drop a redundant index.
--
-- During the 2026-06-17 disk-IO incident we set aggressive autovacuum/analyze on the
-- five bulk-upserted Synergy-sync tables (via execute_sql, untracked) so planner stats
-- never go stale between syncs and the planner stops choosing seq scans for lack of
-- stats. This migration mirrors that change into version control and re-asserts it
-- idempotently (SET of identical storage params is a no-op if already present).
--
-- It also drops idx_products_synergy_id, which is redundant: products.synergy_id already
-- has a UNIQUE constraint (products_synergy_id_key) whose backing btree serves every
-- synergy_id lookup. Two identical btrees on one column just doubles write/maintenance
-- cost for no read benefit.
ALTER TABLE products          SET (autovacuum_analyze_scale_factor = 0.05, autovacuum_analyze_threshold = 200, autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE customers         SET (autovacuum_analyze_scale_factor = 0.05, autovacuum_analyze_threshold = 200, autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE contacts          SET (autovacuum_analyze_scale_factor = 0.05, autovacuum_analyze_threshold = 200, autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE ship_to_locations SET (autovacuum_analyze_scale_factor = 0.05, autovacuum_analyze_threshold = 200, autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE synergy_po_lines  SET (autovacuum_analyze_scale_factor = 0.05, autovacuum_analyze_threshold = 200, autovacuum_vacuum_scale_factor = 0.1);

DROP INDEX IF EXISTS idx_products_synergy_id;
