-- 103_backfill_parts_requested_to_review.sql
-- One-time backfill: move legacy "To Order" part lines that never went through the
-- new Review step (added 2026-06-09, migration 102 / PR #93) back into pending_review,
-- so the office can make the stock-vs-order decision on them.
--
-- Only flips status='requested' lines that have NO per-line po_number, on tickets with
-- NO synergy_order_number. The synergy_order_number gate also excludes imported-from-
-- Synergy tickets (they always carry that number and keep their detail in parts_used,
-- not parts_requested). Lines already in flight (have a PO or SO) are left in To Order.
--
-- Idempotent: flipped rows are no longer 'requested', so a re-run matches nothing.
-- Array order is preserved via WITH ORDINALITY + ORDER BY ord. The trailing EXISTS
-- guard ensures only tickets with >=1 qualifying line are rewritten, so jsonb_agg
-- never runs over an empty array (no risk of nulling the column).

UPDATE pm_tickets t
SET parts_requested = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'status' = 'requested'
       AND NULLIF(elem->>'po_number', '') IS NULL
      THEN jsonb_set(elem, '{status}', '"pending_review"'::jsonb)
      ELSE elem
    END ORDER BY ord)
  FROM jsonb_array_elements(t.parts_requested) WITH ORDINALITY AS arr(elem, ord)
)
WHERE jsonb_typeof(t.parts_requested) = 'array'
  AND NULLIF(t.synergy_order_number, '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(t.parts_requested) AS e(elem)
    WHERE e.elem->>'status' = 'requested'
      AND NULLIF(e.elem->>'po_number', '') IS NULL
  );

UPDATE service_tickets t
SET parts_requested = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'status' = 'requested'
       AND NULLIF(elem->>'po_number', '') IS NULL
      THEN jsonb_set(elem, '{status}', '"pending_review"'::jsonb)
      ELSE elem
    END ORDER BY ord)
  FROM jsonb_array_elements(t.parts_requested) WITH ORDINALITY AS arr(elem, ord)
)
WHERE jsonb_typeof(t.parts_requested) = 'array'
  AND NULLIF(t.synergy_order_number, '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(t.parts_requested) AS e(elem)
    WHERE e.elem->>'status' = 'requested'
      AND NULLIF(e.elem->>'po_number', '') IS NULL
  );
