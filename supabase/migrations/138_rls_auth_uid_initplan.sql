-- Wrap bare auth.uid() calls in RLS policies as (select auth.uid()).
--
-- Postgres re-evaluates a bare auth.uid() per ROW; the subselect form is
-- hoisted into an InitPlan and evaluated once per QUERY (Supabase advisor
-- lint auth_rls_initplan — 26 policies flagged). Semantics are identical:
-- these statements were generated mechanically from the live pg_policies
-- decompiled expressions with auth.uid() -> (select auth.uid()) as the only
-- change. Access-matrix row counts verified identical before/after on the
-- dev environment for a technician session across all affected tables.

ALTER POLICY ace_labor_tech_insert ON public.ace_labor_entries WITH CHECK (((get_user_role() = 'technician'::text) AND (tech_id = (select auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY ace_labor_tech_select ON public.ace_labor_entries USING (((get_user_role() = 'technician'::text) AND (tech_id = (select auth.uid()))));
ALTER POLICY ace_labor_tech_update ON public.ace_labor_entries USING (((get_user_role() = 'technician'::text) AND (tech_id = (select auth.uid())) AND (status = ANY (ARRAY['pending'::text, 'rejected'::text]))));
ALTER POLICY credit_reviews_tech_select ON public.credit_reviews USING (((get_user_role() = 'technician'::text) AND (((pm_ticket_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pm_tickets t
  WHERE ((t.id = credit_reviews.pm_ticket_id) AND (t.assigned_technician_id = (select auth.uid())))))) OR ((service_ticket_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM service_tickets s
  WHERE ((s.id = credit_reviews.service_ticket_id) AND (s.assigned_technician_id = (select auth.uid())))))))));
ALTER POLICY device_pins_own_delete ON public.device_pins USING ((user_id = (select auth.uid())));
ALTER POLICY device_pins_own_select ON public.device_pins USING ((user_id = (select auth.uid())));
ALTER POLICY "Authenticated insert equipment_notes" ON public.equipment_notes WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY feedback_submissions_authenticated_insert ON public.feedback_submissions WITH CHECK ((submitted_by_id = (select auth.uid())));
ALTER POLICY notifications_own_select ON public.notifications USING ((user_id = (select auth.uid())));
ALTER POLICY notifications_own_update ON public.notifications USING ((user_id = (select auth.uid())));
ALTER POLICY "Technicians see own tickets" ON public.pm_tickets USING (((get_user_role() = 'technician'::text) AND (assigned_technician_id = (select auth.uid()))));
ALTER POLICY "Technicians update own tickets" ON public.pm_tickets USING (((get_user_role() = 'technician'::text) AND (assigned_technician_id = (select auth.uid()))));
ALTER POLICY push_subscriptions_own_delete ON public.push_subscriptions USING ((user_id = (select auth.uid())));
ALTER POLICY push_subscriptions_own_insert ON public.push_subscriptions WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY push_subscriptions_own_select ON public.push_subscriptions USING ((user_id = (select auth.uid())));
ALTER POLICY push_subscriptions_own_update ON public.push_subscriptions USING ((user_id = (select auth.uid())));
ALTER POLICY service_tickets_tech_insert ON public.service_tickets WITH CHECK (((get_user_role() = 'technician'::text) AND current_user_can_create_service_tickets() AND (created_by_id = (select auth.uid())) AND (assigned_technician_id = (select auth.uid())) AND (ticket_type = 'outside'::text)));
ALTER POLICY service_tickets_tech_select ON public.service_tickets USING (((get_user_role() = 'technician'::text) AND ((assigned_technician_id = (select auth.uid())) OR ((status = ANY (ARRAY['completed'::text, 'billed'::text])) AND (equipment_id IN ( SELECT get_tech_equipment_ids() AS get_tech_equipment_ids))))));
ALTER POLICY service_tickets_tech_update ON public.service_tickets USING (((get_user_role() = 'technician'::text) AND (assigned_technician_id = (select auth.uid()))));
ALTER POLICY ship_to_requests_insert ON public.ship_to_requests WITH CHECK ((requested_by = (select auth.uid())));
ALTER POLICY ship_to_requests_select ON public.ship_to_requests USING (((requested_by = (select auth.uid())) OR (get_user_role() = ANY (ARRAY['manager'::text, 'coordinator'::text, 'super_admin'::text]))));
ALTER POLICY supply_requests_tech_delete ON public.supply_requests USING (((get_user_role() = 'technician'::text) AND (requested_by = (select auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY supply_requests_tech_insert ON public.supply_requests WITH CHECK (((get_user_role() = 'technician'::text) AND (requested_by = (select auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY supply_requests_tech_select ON public.supply_requests USING (((get_user_role() = 'technician'::text) AND (requested_by = (select auth.uid()))));
ALTER POLICY tech_leads_tech_insert ON public.tech_leads WITH CHECK (((get_user_role() = 'technician'::text) AND (submitted_by = (select auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY tech_leads_tech_select ON public.tech_leads USING (((get_user_role() = 'technician'::text) AND (submitted_by = (select auth.uid()))));
