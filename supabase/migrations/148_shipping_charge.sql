-- 148: pass inbound freight through to the customer.
--
-- Feedback #80 (Mike Jennings, technician, 2026-07-21, WO-1132): the branch pays
-- a minimum $25 to have special-order parts shipped in and has nowhere to bill it.
-- Confirmed against prod at the time of writing: across EVERY service and PM
-- ticket ever written, zero carry a shipping or freight line. This is not an
-- under-used field, it is a missing one — the branch has eaten 100% of inbound
-- freight to date.
--
-- Flat dollars, not the qty × rate shape trip_charge_qty uses (migration 107).
-- Freight is genuinely variable per shipment: a Karcher minimum, a UPS overnight,
-- and a pallet LTL charge have no common per-unit rate to multiply. NULL means
-- no freight is being charged, which is distinct from an explicit 0.
--
-- Deliberately a ticket-level column rather than a line in parts_used. The
-- completion form PUTs the whole parts_used array on autosave, so a freight line
-- written by the office at order time could be silently dropped by a technician
-- whose form was loaded first — the exact race migration 145 exists to close for
-- part lines. A column is not reachable from that array at all.
--
-- Mirrors 105_trip_charge.sql, including the non-negative CHECK.

ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS shipping_charge numeric CHECK (shipping_charge >= 0);
ALTER TABLE pm_tickets      ADD COLUMN IF NOT EXISTS shipping_charge numeric CHECK (shipping_charge >= 0);

COMMENT ON COLUMN service_tickets.shipping_charge IS
  'Inbound freight billed to the customer, flat dollars. NULL = none charged. Office-entered (Parts Queue / ticket detail); never written by technicians.';
COMMENT ON COLUMN pm_tickets.shipping_charge IS
  'Inbound freight billed to the customer, flat dollars. NULL = none charged. Office-entered (Parts Queue / ticket detail); never written by technicians.';

NOTIFY pgrst, 'reload schema';
