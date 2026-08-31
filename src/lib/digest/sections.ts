import type { DigestDb, DigestOwner, DigestRow, KeyPrefix } from './types'
import * as f from './fetchers'

// The sixteen action queues the morning digest surfaces, grouped by who does
// the work. Adding a section here is the only place it needs registering: the
// email template renders whatever this list contains, and the headline dedupe
// reads the declared key prefixes.

export type DigestSection = {
  key: string
  owner: DigestOwner
  title: string
  action: string
  viewAllPath: string
  /**
   * Non-empty. Every row this section emits must use one of these prefixes.
   *
   * It is a set rather than a single value because "ready to bill" is genuinely
   * mixed, listing PM tickets and service tickets side by side. Declaring the
   * set is what lets a test catch a section whose rows point at a different
   * entity than it claims, which would silently corrupt the distinct headline
   * without throwing anything.
   */
  keyPrefixes: readonly KeyPrefix[]
  fetch: (db: DigestDb) => Promise<DigestRow[]>
}

export type OwnerBlock = {
  owner: DigestOwner
  heading: string
  role: string
  fg: string
  tint: string
}

export const OWNER_BLOCKS: readonly OwnerBlock[] = [
  { owner: 'service', heading: 'KEN', role: 'Service Execution', fg: '#1e40af', tint: '#eff6ff' },
  { owner: 'billing', heading: 'KEN', role: 'Office and Billing', fg: '#0f766e', tint: '#f0fdfa' },
  {
    owner: 'ar',
    heading: 'OFFICE AND AR',
    role: 'Customer Chases and Account Blocks',
    fg: '#7c3aed',
    tint: '#f5f3ff',
  },
]

export const SECTIONS: readonly DigestSection[] = [
  // --- KEN, Service Execution ---
  {
    key: 'overdue_pms',
    owner: 'service',
    title: 'Overdue PMs',
    action: 'assign a tech and schedule',
    viewAllPath: '/tickets',
    keyPrefixes: ['pm'],
    fetch: f.overduePms,
  },
  {
    key: 'idle_service',
    owner: 'service',
    title: 'Idle service tickets',
    action: 'push to the next step',
    viewAllPath: '/service',
    keyPrefixes: ['svc'],
    fetch: f.idleServiceTickets,
  },
  {
    key: 'skip_requests',
    owner: 'service',
    title: 'Skip requests',
    action: 'approve or deny each skip',
    viewAllPath: '/tickets',
    keyPrefixes: ['pm'],
    fetch: f.skipRequests,
  },
  {
    key: 'leads_waiting',
    owner: 'service',
    title: 'Leads waiting',
    action: 'approve and forward to a rep',
    viewAllPath: '/tech-leads',
    keyPrefixes: ['lead'],
    fetch: f.leadsWaiting,
  },

  // --- KEN, Office and Billing ---
  {
    key: 'ready_to_bill',
    owner: 'billing',
    title: 'Ready to bill',
    action: 'export to Synergy billing',
    viewAllPath: '/billing',
    keyPrefixes: ['pm', 'svc'],
    fetch: f.readyToBill,
  },
  {
    key: 'estimates_awaiting',
    owner: 'billing',
    title: 'Estimates awaiting approval',
    action: 'chase the customer for approval',
    viewAllPath: '/estimate-queue',
    keyPrefixes: ['svc'],
    fetch: f.estimatesAwaitingApproval,
  },
  {
    key: 'declined_unresolved',
    owner: 'billing',
    title: 'Declined estimates',
    action: 'close it out or arrange the return',
    viewAllPath: '/declined-queue',
    keyPrefixes: ['svc'],
    fetch: f.declinedUnresolved,
  },
  {
    key: 'idle_pickups',
    owner: 'billing',
    title: 'Idle pickups',
    action: 'notify the customer and arrange pickup',
    viewAllPath: '/pickup-queue',
    keyPrefixes: ['svc'],
    fetch: f.idlePickups,
  },
  {
    key: 'parts_stuck',
    owner: 'billing',
    title: 'Parts stuck',
    action: 'triage, order, pull, or chase the vendor',
    viewAllPath: '/parts-queue',
    keyPrefixes: ['part'],
    fetch: f.partsStuck,
  },
  {
    key: 'not_entered_synergy',
    owner: 'billing',
    title: 'Completed jobs not yet entered in Synergy',
    action: 'key the Synergy order number',
    viewAllPath: '/billing/po-follow-up',
    keyPrefixes: ['pm', 'svc'],
    fetch: f.notEnteredSynergy,
  },

  // --- OFFICE AND AR ---
  {
    key: 'po_gated',
    owner: 'ar',
    title: 'Waiting on a customer PO',
    action: 'chase the customer for a PO',
    viewAllPath: '/billing/po-follow-up',
    keyPrefixes: ['pm', 'svc'],
    fetch: f.poGatedBilling,
  },
  {
    key: 'ship_to_requests',
    owner: 'ar',
    title: 'Ship-to requests',
    action: 'add the address in Synergy',
    viewAllPath: '/ship-to-requests',
    keyPrefixes: ['shipto'],
    fetch: f.shipToRequestsPending,
  },
  {
    key: 'warranty_to_review',
    owner: 'ar',
    title: 'Warranty reviews to verify',
    action: 'verify coverage and record the verdict on the ticket',
    viewAllPath: '/warranty-queue',
    keyPrefixes: ['svc'],
    fetch: f.warrantyToReview,
  },
  {
    key: 'warranty_to_file',
    owner: 'ar',
    title: 'Warranty claims to file',
    action: 'file the claim with the vendor',
    viewAllPath: '/warranty-queue',
    keyPrefixes: ['svc'],
    fetch: f.warrantyToFile,
  },
  {
    key: 'warranty_awaiting_credit',
    owner: 'ar',
    title: 'Warranty credits to chase',
    action: 'chase the vendor for the credit',
    viewAllPath: '/warranty-queue',
    keyPrefixes: ['svc'],
    fetch: f.warrantyAwaitingCredit,
  },
  {
    key: 'credit_hold',
    owner: 'ar',
    title: 'Credit hold with open work',
    action: 'coordinate AR and release',
    viewAllPath: '/customers',
    keyPrefixes: ['cust'],
    fetch: f.creditHoldWithOpenWork,
  },
]

/** Rows shown per section before collapsing into a "+N more" line. */
export const TOP_N = 5
