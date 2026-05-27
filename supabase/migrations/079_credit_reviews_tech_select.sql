-- Migration 078: Let technicians see the credit-review state of their own tickets.
--
-- Migration 076 granted credit_reviews SELECT only to managers/coordinators, so
-- a technician's PM/service board and ticket detail rendered no badge or banner
-- for a credit-gated ticket — the work gate (enforced server-side via the admin
-- client) still held, but the tech only discovered it on a failed action (423).
--
-- Add a permissive SELECT policy so a technician can read the review for a ticket
-- assigned to them. This makes the existing CreditReviewBadge + "Awaiting credit
-- review / Blocked by AR" banners populate for techs with no app changes. The
-- EXISTS subqueries hit pm_tickets / service_tickets, neither of whose policies
-- reference credit_reviews, so there is no RLS recursion. block_reason is the
-- only AR free-text on the row; it is operational ("account past due") and the
-- tech-facing UI shows only a generic blocked message (the reason is rendered
-- solely in the manager-only unblock panel).

DROP POLICY IF EXISTS credit_reviews_tech_select ON credit_reviews;
CREATE POLICY credit_reviews_tech_select
  ON credit_reviews FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'technician'
    AND (
      (pm_ticket_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM pm_tickets t
        WHERE t.id = credit_reviews.pm_ticket_id
          AND t.assigned_technician_id = auth.uid()
      ))
      OR
      (service_ticket_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM service_tickets s
        WHERE s.id = credit_reviews.service_ticket_id
          AND s.assigned_technician_id = auth.uid()
      ))
    )
  );
