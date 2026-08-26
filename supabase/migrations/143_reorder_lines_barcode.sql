-- Migration 143: add barcode to reorder_lines (P3 — scan-to-jump)
--
-- The card walk's product-UPC scan matches a scanned barcode to a line
-- CLIENT-SIDE (so it works offline against the already-loaded lines), the
-- same way bin-label scan matches bin_location. That needs the barcode on the
-- snapshotted line, not just on inv_reorder. Snapshotted at session creation
-- (POST /api/purchasing/sessions) alongside the other decision fields.

ALTER TABLE reorder_lines ADD COLUMN IF NOT EXISTS barcode VARCHAR;
