// Shared types for the morning digest.
//
// This file and the other pure digest modules (dedupe, subject, should-run)
// MUST NOT import anything server-side. `server-only` throws at import time,
// so a module that reaches for the Supabase admin client cannot be unit
// tested at all. Keeping these free of server imports is what makes the
// dedupe and subject regression guards possible.

export type DigestOwner = 'service' | 'billing' | 'ar'

export const KEY_PREFIXES = ['svc', 'pm', 'cust', 'lead', 'shipto', 'part'] as const
export type KeyPrefix = (typeof KEY_PREFIXES)[number]

export type DigestBadge = {
  label: string
  fg: string
  bg: string
}

export type DigestRow = {
  /**
   * Fully qualified dedupe identity, `${KeyPrefix}:${id}`. Always build it with
   * entityKey() rather than by hand: the headline counts distinct entities
   * across overlapping sections, and a row whose prefix does not match the
   * entity it points at silently breaks that count.
   */
  entityKey: string
  title: string
  subtitle: string
  meta: string
  deepLink: string
  badge: DigestBadge
}

export function entityKey(prefix: KeyPrefix, id: string): string {
  return `${prefix}:${id}`
}

export type SectionResult =
  | { ok: true; sectionKey: string; rows: DigestRow[] }
  | { ok: false; sectionKey: string; message: string }
