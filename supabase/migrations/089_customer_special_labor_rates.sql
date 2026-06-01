-- 089_customer_special_labor_rates.sql
-- Per-customer negotiated / bid labor rate overrides. CallBoard bills labor at
-- one of three global hourly rates (standard / industrial / vacuum) chosen per
-- ticket via labor_rate_type, stored in the settings table. Some customers have
-- negotiated or bid rates that must override the global value for their tickets.
--
-- One nullable column per rate type. NULL = use the global rate for that type
-- (the default for every customer). A non-null value overrides the global rate
-- for any of that customer's tickets carrying the matching labor_rate_type.
--
-- These affect ONLY what the customer is billed. Internal tech-payout math
-- (ACE labor) deliberately keeps using the global rate.
--
-- Renumbered 088 -> 089: a parallel PR merged 088_product_requires_detail.sql.
-- Already applied to prod under timestamp version (name: customer_special_labor_rates);
-- this rename is filename-only and has no DB effect.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS special_labor_rate_standard   numeric CHECK (special_labor_rate_standard   >= 0),
  ADD COLUMN IF NOT EXISTS special_labor_rate_industrial numeric CHECK (special_labor_rate_industrial >= 0),
  ADD COLUMN IF NOT EXISTS special_labor_rate_vacuum     numeric CHECK (special_labor_rate_vacuum     >= 0);
