-- Migration 065: Add `kind` + `title` to sales_reps.
--
-- The lead-forward flow now routes to one of three kinds: outside Sales Reps,
-- Sales Managers, and Branch Managers. Managers can be CCed on a send or be
-- the primary recipient when the manager (not Caleb) should pick the rep that
-- runs with the lead. `title` is the verbatim string from the source data
-- (e.g. "Sales Rep", "Sales Manager", "Branch Manager"); `kind` is the
-- normalized enum the app branches on.

ALTER TABLE sales_reps
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'rep'
    CHECK (kind IN ('rep', 'sales_manager', 'branch_manager')),
  ADD COLUMN title TEXT
    CHECK (title IS NULL OR length(title) <= 200);

CREATE INDEX idx_sales_reps_kind ON sales_reps (kind);

COMMENT ON COLUMN sales_reps.kind IS
  'Routing role. `rep` = primary recipient candidate; `sales_manager` and `branch_manager` = primary OR CC candidate.';
COMMENT ON COLUMN sales_reps.title IS
  'Verbatim title string from the source roster (display-only). Falls back to kind label in the UI when NULL.';
