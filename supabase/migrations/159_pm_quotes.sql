-- Migration 159: PM quotes
--
-- Some PM customers will not authorize scheduled maintenance until they have a
-- written price, usually because their AP process needs a PO cut against it.
-- CallBoard had no quote concept for PMs at all: the only PM price anywhere was
-- pm_schedules.flat_rate, and the only customer-facing priced document was the
-- service estimate, which lives on service_tickets.
--
-- One quote spans many PM work orders for one customer. Every line carries a
-- SNAPSHOT of the price and equipment description as of the moment the quote was
-- built, because pm_schedules.flat_rate is editable and a customer who accepted
-- $200.00 must keep being owed $200.00.
--
-- The workflow is opt-in per customer (customers.pm_quote_required). Most PM
-- customers never ask for a quote, so the badges, queues, and the start-work
-- gate that Round 3 adds only surface for the accounts that need them. Staff can
-- still hand-build a quote for any customer; the flag governs the automatic
-- surfacing, not the ability to produce a document.

-- ============================================================
-- Per-customer opt-in
-- ============================================================

ALTER TABLE customers
  ADD COLUMN pm_quote_required BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN customers.pm_quote_required IS
  'Opt-in: this account requires an accepted PM quote before work starts. Drives the Quote Needed badge, the quote queue, and the start-work gate. Does not restrict who can build a quote.';

-- ============================================================
-- Quote numbering
--
-- Deliberately its own sequence, NOT pm_tickets_wo_seq. That sequence is already
-- shared between pm_tickets and service_tickets and means "work order"; a quote
-- is a different kind of object and gets its own Q- series.
-- ============================================================

CREATE SEQUENCE pm_quotes_seq START 1000;

-- ============================================================
-- pm_quotes
-- ============================================================

CREATE TABLE pm_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quote_number INTEGER NOT NULL UNIQUE DEFAULT nextval('pm_quotes_seq'),

  customer_id INTEGER NOT NULL,
  CONSTRAINT pm_quotes_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id),

  -- draft   : built, not yet handed to the customer
  -- sent    : delivered (PDF handed over or approval link shared)
  -- accepted: customer approved; this is the state the Round 3 gate looks for
  -- declined: customer said no
  -- expired : valid_until passed without a decision
  -- void    : superseded or built in error
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'void')),

  -- Sum of pm_quote_lines.amount at build time, kept denormalized so list
  -- screens and the gate never have to aggregate the lines.
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,

  notes TEXT,
  valid_until DATE,

  -- Public approval link (Round 3). 12-char base64url, same shape as the
  -- service estimate token and the credit-review token.
  approval_token TEXT UNIQUE,
  approval_token_expires_at TIMESTAMPTZ,

  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,

  -- Captured from the customer at acceptance and pushed onto the quoted
  -- tickets. This is the whole point of the feature for PO-required accounts.
  po_number TEXT,
  signature TEXT,
  signature_name TEXT,

  created_by_id UUID,
  CONSTRAINT pm_quotes_created_by_id_fkey
    FOREIGN KEY (created_by_id) REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_pm_quotes_customer_id ON pm_quotes(customer_id);
CREATE INDEX idx_pm_quotes_status ON pm_quotes(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_pm_quotes_approval_token ON pm_quotes(approval_token)
  WHERE approval_token IS NOT NULL;

CREATE TRIGGER set_pm_quotes_updated_at
  BEFORE UPDATE ON pm_quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE pm_quotes IS
  'Customer-facing quote covering one or more PM work orders for a single customer. Accepted quotes carry the PO number the customer supplied and gate the start of work for customers.pm_quote_required accounts.';

-- ============================================================
-- pm_quote_lines
--
-- Snapshots, not joins. Reading make/model/flat_rate live at print time would
-- let an edit to the schedule silently change what a customer already accepted.
-- ============================================================

CREATE TABLE pm_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quote_id UUID NOT NULL,
  CONSTRAINT pm_quote_lines_quote_id_fkey
    FOREIGN KEY (quote_id) REFERENCES pm_quotes(id) ON DELETE CASCADE,

  pm_ticket_id UUID NOT NULL,
  CONSTRAINT pm_quote_lines_pm_ticket_id_fkey
    FOREIGN KEY (pm_ticket_id) REFERENCES pm_tickets(id),

  -- Snapshot columns
  work_order_number INTEGER,
  equipment_label TEXT,
  equipment_description TEXT,
  serial_number TEXT,
  interval_months INTEGER,
  billing_type TEXT,
  amount DECIMAL(10,2) NOT NULL,
  scope_note TEXT,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A work order appears at most once on a given quote.
CREATE UNIQUE INDEX idx_pm_quote_lines_quote_ticket
  ON pm_quote_lines(quote_id, pm_ticket_id);

-- The gate's lookup: given a set of ticket ids, find accepted quote coverage.
CREATE INDEX idx_pm_quote_lines_pm_ticket_id ON pm_quote_lines(pm_ticket_id);

COMMENT ON TABLE pm_quote_lines IS
  'One quoted PM work order. Price and equipment fields are snapshots taken when the quote was built so an edit to pm_schedules.flat_rate cannot change an already-accepted price.';

-- ============================================================
-- RLS
--
-- Staff only. Technicians deliberately get NO policy: the tech-facing block
-- reason in Round 3 is resolved server-side and passed down as a boolean, so
-- techs never need to read quote rows (and never see customer pricing).
-- The public approval route reads through the service-role admin client.
-- ============================================================

ALTER TABLE pm_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_quote_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY pm_quotes_staff_select ON pm_quotes
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quotes_staff_insert ON pm_quotes
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quotes_staff_update ON pm_quotes
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quotes_super_admin_delete ON pm_quotes
  FOR DELETE USING (get_user_role() = 'super_admin');

CREATE POLICY pm_quote_lines_staff_select ON pm_quote_lines
  FOR SELECT USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quote_lines_staff_insert ON pm_quote_lines
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quote_lines_staff_update ON pm_quote_lines
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'manager', 'coordinator'));

CREATE POLICY pm_quote_lines_super_admin_delete ON pm_quote_lines
  FOR DELETE USING (get_user_role() = 'super_admin');
