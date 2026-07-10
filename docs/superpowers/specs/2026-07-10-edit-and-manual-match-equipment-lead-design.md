# Edit + manually match an equipment-sales lead (feedback #74)

**Date:** 2026-07-10
**Feedback:** #74 — "I need the ability to edit and manually approve an equipment sales lead."
**Branch:** `feedback/74-caleb-needs-the-ability-to-edit`

## Problem

A manager on `/tech-payouts` cannot correct a submitted equipment-sales lead once it
leaves `pending`, and cannot force a payout when the nightly Synergy scan doesn't
surface a match. The concrete case: Jacob Essmon's lead (`4587f329…`) was approved
against the wrong customer account (8565 instead of 8564), so the nightly matcher —
which keys on `customers.synergy_id` via `tech_leads.customer_id` — never sees the
T260 sale (invoice 949635) that closed under 8564. The lead sits in "Awaiting Match"
with no way to fix the account or pay the tech.

Two structural gaps:

1. **No edit path past `pending`.** `PATCH /api/tech-leads/[id]` already edits every
   content field (including `customer_id`), but is hard-gated to `status='pending'`
   and is only wired to the tech's own `/my-leads` editor. The manager review modal
   (`LeadReviewModal`) is read-only.
2. **No manual match.** `equipment_sale_lead_candidates` rows are created **only** by
   the nightly `scan-equipment-sale-candidates.py` job (service-role, no INSERT RLS).
   There is no UI/API to attach a known Synergy order and earn the lead on demand.

The immediate data remediation (repoint lead `4587f329` from customer 5587 → 5586)
has already been applied to prod so Jacob's payout isn't blocked on this work.

## Key reuse discovery

`src/app/my-leads/SubmitLeadModal.tsx` is **already** a complete, validated, editable
lead form with a customer/account combobox, contact fields, tier select, and notes.
In `isEdit` mode it PATCHes `/api/tech-leads/[id]`. We reuse it as the manager's editor
rather than rebuilding an edit form inside `LeadReviewModal`. This keeps one source of
truth for lead-field editing and validation.

## Design

### 1. Widen the edit gate for managers (`PATCH /api/tech-leads/[id]`)

- Current gate: `isOwner || isManager` **and** `status === 'pending'`.
- New rule:
  - Owner (tech): unchanged — pending only.
  - `RESET_ROLES` (super_admin/manager): may edit while status ∈ {`pending`,
    `approved`, `match_pending`}. Blocked on terminal states (`earned`, `paid`,
    `cancelled`, `rejected`, `expired`) → 409.
  - The widened window (approved/match_pending) applies to **equipment_sale** leads
    only. PM leads stay pending-only (their approved state links equipment and feeds
    a different earn trigger — out of scope).
- The route still writes **only content fields** (never status/approval/earn/expiry),
  so the `lock_paid_lead_fields` trigger is never provoked (it only fires on
  earned/paid).
- **Candidate hygiene on account change:** after the field UPDATE, if the lead is
  equipment_sale, was non-`pending`, and `customer_id` actually changed, then via the
  admin client: dismiss any `status='pending'` candidates for the lead (they belong to
  the old account) and, if the lead was `match_pending`, reset it to `approved` so the
  next scan re-evaluates against the corrected account. Detected by re-reading the
  lead's current `customer_id` before the update.
- The `WHERE` guard on the write repeats the status set so a concurrent approve/earn
  can't be silently clobbered (mirrors the existing pending guard).

### 2. Surface the editor on `/tech-payouts`

- Import `SubmitLeadModal`; add `editLead` state and render it in edit mode.
- Add an **Edit** button:
  - Pending equipment-sale rows (Submitted Leads tab) — next to **Review**.
  - Approved equipment-sale rows (Awaiting Match tab) — next to the "Waiting on
    Synergy sale" label / **Cancel**.
- Add an **"Edit details"** button inside `LeadReviewModal` (choose mode) that closes
  the review modal and opens `SubmitLeadModal` on the same lead, so a manager can
  correct fields and then approve. (Edit and approve stay distinct actions; no combined
  save-and-approve button — the review modal already owns approval.)
- `SubmitLeadModal` uses form drafts only when `!isEdit`, so manager edits never touch
  or pollute the new-lead draft.

### 3. Manual match (`POST /api/tech-leads/[id]/manual-match` + `ManualMatchModal`)

- **Route:** `RESET_ROLES`-gated. Body `{ synergy_order_number, synergy_order_date,
  tier, synergy_order_total? }`.
  - Validate: lead is equipment_sale and status ∈ {`approved`, `match_pending`}; tier
    ∈ `EQUIPMENT_SALE_TIERS`; order number is a positive integer; order date is a valid
    date. `synergy_order_date` is **required** (candidate column is NOT NULL).
  - Insert a candidate via the admin client (`SERVER_ONLY`) with `status='pending'`
    and `order_lines='[]'` (the manual origin is implicit — `reviewed_by` is stamped
    by the confirm step). On unique conflict `(tech_lead_id, synergy_order_number)`,
    reuse the existing candidate id (fetch it) rather than failing.
  - Call the existing atomic `confirm_match_candidate(lead, candidate, tier, bonus,
    user)` RPC → lead flips to `earned` with the tier's bonus, siblings dismissed.
    Map its `P0001` to 409.
  - **No new migration** — reuses the existing candidate table + confirm RPC.
- **UI:** `ManualMatchModal` (small; modeled on `ConfirmMatchModal`): Synergy order
  number, order date (defaults to today), tier select (defaults to the lead's proposed
  tier), optional order total. Submit → POST → `router.refresh()`. Opened from a
  **"Manually match a sale"** button on approved equipment-sale rows.

### 4. Permissions / proxy

All new writes enforce role in-handler (`RESET_ROLES`). `proxy.ts` already lets techs
reach `/api/tech-leads/*` but the routes gate themselves and techs are page-blocked
from `/tech-payouts`; **no proxy change needed**.

## Out of scope

- Feedback #56 (auto-populate sales rep on the review modal).
- Editing PM leads past `pending`.
- Editing terminal-state leads (earned/paid/cancelled/rejected/expired).
- Backfilling `order_lines` for manually-matched candidates (left `[]`).

## Testing / verification

- Unit: `validateLeadFields` already covered; add coverage for the manual-match route's
  input validation and the manager edit-gate widening (status matrix) if a route test
  harness exists; otherwise assert via typed helper functions.
- The worktree has **no `node_modules`** — scope `tsc`/lint to touched files and verify
  end-to-end on the Vercel preview. Watch the `react-hooks/set-state-in-effect` build
  gate (keep `setState` out of synchronous effect bodies).
- Manual E2E on preview: (a) edit an approved equipment-sale lead's account → save →
  confirm candidates dismissed / status reset; (b) manual-match an approved lead →
  lead earns with correct bonus; (c) confirm terminal-state leads reject edits.

## Rollout

`/ship` builds/lints, commits, pushes the branch (Vercel preview), opens the PR against
master, and stamps the feedback row — status stays `in_progress` until Caleb merges.
No new migration to apply.
