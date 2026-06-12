-- Customer PO # on service tickets.
--
-- Service tickets previously had no place to record the customer's purchase
-- order number — the detail page showed a red "PO REQUIRED" banner but no
-- input, so a tech who received the PO during a repair had nowhere to enter it
-- (feedback #38). This mirrors pm_tickets.po_number (migration 015). The
-- per-line po_number inside parts_requested is a separate concept (the vendor
-- PO used when the office orders a part) and is unaffected.
ALTER TABLE service_tickets
  ADD COLUMN po_number TEXT;
