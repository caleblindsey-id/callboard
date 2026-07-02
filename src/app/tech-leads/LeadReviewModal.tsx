'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import type { TicketPhoto, SalesRep, SalesRepKind } from '@/types/database'
import { tierLabel, EQUIPMENT_SALE_TIERS } from '@/lib/tech-leads/bonus-tiers'
import { createClient } from '@/lib/supabase/client'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  lead: TechLeadWithJoins | null
  salesReps?: SalesRep[]
  onClose: () => void
  onDone: () => void
  // PM leads chain straight from approve into Create Equipment. When provided,
  // approving a PM lead calls this (with the just-approved lead) instead of the
  // generic onDone, so the parent can open the create-equipment modal.
  onApprovedPm?: (lead: TechLeadWithJoins) => void
}

const NOTE_MAX = 500
const CC_MAX = 10
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/

const KIND_GROUP_LABEL: Record<SalesRepKind, string> = {
  branch_manager: 'Branch Managers',
  sales_manager: 'Sales Managers',
  rep: 'Sales Reps',
}

export default function LeadReviewModal({ lead, salesReps = [], onClose, onDone, onApprovedPm }: Props) {
  const [mode, setMode] = useState<'choose' | 'reject' | 'email_rep'>('choose')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [selectedRepId, setSelectedRepId] = useState('')
  const [ccIds, setCcIds] = useState<Set<string>>(new Set())
  const [ccEmails, setCcEmails] = useState<string[]>([])
  const [ccEmailInput, setCcEmailInput] = useState('')
  const [ccEmailError, setCcEmailError] = useState<string | null>(null)
  const [repNote, setRepNote] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  // Dirty when the manager has typed a rejection reason or built up the
  // approve-and-email form — a backdrop tap must not silently wipe it (FE-4).
  const isDirty =
    reason.trim() !== '' ||
    selectedRepId !== '' ||
    ccIds.size > 0 ||
    ccEmails.length > 0 ||
    ccEmailInput.trim() !== '' ||
    repNote.trim() !== ''

  useEffect(() => {
    if (lead) {
      setMode('choose')
      setReason('')
      setError(null)
      setSubmitting(false)
      setSelectedRepId('')
      setCcIds(new Set())
      setCcEmails([])
      setCcEmailInput('')
      setCcEmailError(null)
      setRepNote('')
      setConfirmDiscardOpen(false)
    }
  }, [lead])

  const repsByKind = useMemo(() => {
    const groups: Record<SalesRepKind, SalesRep[]> = { branch_manager: [], sales_manager: [], rep: [] }
    for (const r of salesReps) groups[r.kind].push(r)
    return groups
  }, [salesReps])

  const selectedRep = useMemo(
    () => salesReps.find(r => r.id === selectedRepId),
    [salesReps, selectedRepId]
  )
  const isManagerPrimary = !!selectedRep && selectedRep.kind !== 'rep'

  const ccCandidates = useMemo(
    () => salesReps.filter(r => r.kind !== 'rep' && r.id !== selectedRepId),
    [salesReps, selectedRepId]
  )

  // Fetch signed URLs (1h) for any attached machine photos.
  useEffect(() => {
    const photos = (lead?.photos as TicketPhoto[] | undefined) ?? []
    if (!lead || photos.length === 0) {
      setPhotoUrls([])
      return
    }
    let cancelled = false
    const supabase = createClient()
    Promise.all(
      photos.map(async (p) => {
        const { data } = await supabase.storage
          .from('ticket-photos')
          .createSignedUrl(p.storage_path, 3600)
        return data?.signedUrl ?? null
      })
    ).then((urls) => {
      if (cancelled) return
      setPhotoUrls(urls.filter((u): u is string => !!u))
    })
    return () => {
      cancelled = true
    }
  }, [lead])

  // Escape-to-dismiss (dirty-guarded). While the discard confirm is up, its
  // own Escape handling wins — this listener stands down so the same
  // keystroke can't re-open the confirm it just dismissed.
  useEffect(() => {
    if (!lead) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting || confirmDiscardOpen) return
      if (isDirty) setConfirmDiscardOpen(true)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lead, submitting, onClose, isDirty, confirmDiscardOpen])

  if (!lead) return null

  function requestClose() {
    if (submitting) return
    if (isDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    onClose()
  }

  async function post(payload: Record<string, unknown>) {
    if (!lead) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${lead.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to update lead.')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lead.')
      setSubmitting(false)
    }
  }

  async function handleApprove() {
    if (!lead) return
    // PM leads chain into Create Equipment; defer to onApprovedPm so the parent
    // can open that modal with the freshly-approved lead. Everything else (and
    // the PM path when no handler is wired) falls back to the generic onDone.
    if (lead.lead_type === 'pm' && onApprovedPm) {
      const approvedLead = lead
      setSubmitting(true)
      setError(null)
      try {
        const res = await fetch(`/api/tech-leads/${approvedLead.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Failed to update lead.')
        onApprovedPm(approvedLead)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update lead.')
        setSubmitting(false)
      }
      return
    }
    await post({ action: 'approve' })
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError('Enter a rejection reason.')
      return
    }
    await post({ action: 'reject', reason: reason.trim() })
  }

  async function handleApproveAndEmail() {
    if (!lead) return
    if (!selectedRepId) {
      setError('Pick a recipient to forward this lead to.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${lead.id}/approve-and-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_rep_id: selectedRepId,
          cc_ids: Array.from(ccIds),
          cc_emails: ccEmails,
          note: repNote.trim().slice(0, NOTE_MAX),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to approve and email lead.')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve and email lead.')
      setSubmitting(false)
    }
  }

  const ccTotal = ccIds.size + ccEmails.length

  function toggleCc(id: string) {
    setCcIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size + ccEmails.length < CC_MAX) next.add(id)
      return next
    })
  }

  function addCcEmail() {
    const email = ccEmailInput.trim().toLowerCase()
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      setCcEmailError('Enter a valid email address.')
      return
    }
    if (ccEmails.includes(email) || selectedRep?.email.toLowerCase() === email) {
      setCcEmailError('That address is already on the list.')
      return
    }
    if (ccTotal >= CC_MAX) {
      setCcEmailError(`Up to ${CC_MAX} CC recipients.`)
      return
    }
    setCcEmails(prev => [...prev, email])
    setCcEmailInput('')
    setCcEmailError(null)
  }

  function removeCcEmail(email: string) {
    setCcEmails(prev => prev.filter(e => e !== email))
    setCcEmailError(null)
  }

  const customerLabel = lead.customers?.name
    ? lead.customers.name
    : lead.customer_name_text
      ? `${lead.customer_name_text} (new customer — not yet in system)`
      : '—'

  const isEquipmentSale = lead.lead_type === 'equipment_sale'
  const proposedTier = lead.proposed_equipment_tier
  const tierBonus = proposedTier && proposedTier in EQUIPMENT_SALE_TIERS
    ? EQUIPMENT_SALE_TIERS[proposedTier].amount
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-review-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) requestClose()
      }}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={requestClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 max-h-[95vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 id="lead-review-title" className="text-base font-semibold text-gray-900 dark:text-white">
            Review tech lead
            {isEquipmentSale && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                Equipment sale
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={requestClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          <Field label="Tech">{lead.submitter?.name ?? '—'}</Field>
          <Field label="Customer">{customerLabel}</Field>
          {lead.customers?.primary_sales_rep && (
            <Field label="Primary sales rep">{lead.customers.primary_sales_rep}</Field>
          )}
          {(lead.contact_name || lead.contact_email || lead.contact_phone) && (
            <Field label="Lead contact">
              <div className="space-y-0.5">
                {lead.contact_name && <div>{lead.contact_name}</div>}
                {lead.contact_email && (
                  <div>
                    <a
                      href={`mailto:${lead.contact_email}`}
                      className="text-slate-700 dark:text-slate-300 hover:underline"
                    >
                      {lead.contact_email}
                    </a>
                  </div>
                )}
                {lead.contact_phone && (
                  <div>
                    <a
                      href={`tel:${lead.contact_phone.replace(/[^\d+]/g, '')}`}
                      className="text-slate-700 dark:text-slate-300 hover:underline"
                    >
                      {lead.contact_phone}
                    </a>
                  </div>
                )}
              </div>
            </Field>
          )}
          {isEquipmentSale ? (
            <>
              <Field label="Proposed equipment tier">
                {proposedTier ? tierLabel(proposedTier) : '—'}
                {tierBonus != null && (
                  <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">
                    (${tierBonus} bonus on confirmed match)
                  </span>
                )}
              </Field>
              {lead.expires_at && (
                <Field label="Match window">
                  expires {new Date(lead.expires_at).toLocaleDateString()}
                </Field>
              )}
            </>
          ) : (
            <>
              {(lead.make || lead.model || lead.serial_number || lead.location_on_site) ? (
                <>
                  {lead.make && <Field label="Make">{lead.make}</Field>}
                  {lead.model && <Field label="Model">{lead.model}</Field>}
                  {lead.serial_number && <Field label="Serial #">{lead.serial_number}</Field>}
                  {lead.location_on_site && (
                    <Field label="Location on-site">{lead.location_on_site}</Field>
                  )}
                </>
              ) : (
                <Field label="Equipment">
                  <p className="whitespace-pre-wrap break-words">{lead.equipment_description}</p>
                </Field>
              )}
              {(lead.proposed_start_month != null || lead.proposed_start_year != null) && (
                <Field label="Proposed start">
                  {lead.proposed_start_month != null
                    ? new Date(2000, lead.proposed_start_month - 1, 1).toLocaleString('en-US', { month: 'long' })
                    : '—'}
                  {lead.proposed_start_year != null ? ` ${lead.proposed_start_year}` : ''}
                </Field>
              )}
              {lead.proposed_pm_frequency && (
                <Field label="Proposed frequency">{lead.proposed_pm_frequency}</Field>
              )}
              {lead.quoted_amount && (
                <Field label="Tech quoted">{lead.quoted_amount}</Field>
              )}
            </>
          )}
          {lead.notes && (
            <Field label="Notes">
              <p className="whitespace-pre-wrap break-words">{lead.notes}</p>
            </Field>
          )}
          {photoUrls.length > 0 && (
            <Field label="Machine photos">
              <div className="grid grid-cols-3 gap-2 mt-1">
                {photoUrls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Machine photo ${i + 1}`}
                      className="w-full h-full object-cover hover:opacity-90"
                    />
                  </a>
                ))}
              </div>
            </Field>
          )}
        </div>

        {error && (
          <p className="px-5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        )}

        {mode === 'choose' && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode('reject')}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              Reject
            </button>
            {isEquipmentSale && (
              <button
                type="button"
                onClick={() => { setError(null); setMode('email_rep') }}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
              >
                Approve & email rep
              </button>
            )}
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
        {mode === 'reject' && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
              Rejection reason (visible to the tech)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Explain why this lead doesn't qualify..."
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode('choose')}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting || !reason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Rejecting…' : 'Reject lead'}
              </button>
            </div>
          </div>
        )}
        {mode === 'email_rep' && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Approves the lead and emails the contact info, notes, and photos to the recipient. CC sales/branch managers or any other email address as needed.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Send to
              </label>
              {salesReps.length === 0 ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  No active sales reps or managers. Add one in Settings first.
                </p>
              ) : (
                <select
                  value={selectedRepId}
                  onChange={e => setSelectedRepId(e.target.value)}
                  autoFocus
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">Select a recipient…</option>
                  {(['branch_manager', 'sales_manager', 'rep'] as SalesRepKind[]).map(kind =>
                    repsByKind[kind].length > 0 ? (
                      <optgroup key={kind} label={KIND_GROUP_LABEL[kind]}>
                        {repsByKind[kind].map(rep => (
                          <option key={rep.id} value={rep.id}>
                            {rep.name}
                            {rep.title ? ` — ${rep.title}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ) : null
                  )}
                </select>
              )}
              {isManagerPrimary && selectedRep && (
                <div className="mt-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                  This will go to <strong>{selectedRep.name}</strong> as a request to assign the lead to one of their reps.
                </div>
              )}
            </div>
            {ccCandidates.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  CC sales / branch managers (optional)
                </label>
                <div className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 max-h-40 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-600">
                  {ccCandidates.map(rep => {
                    const checked = ccIds.has(rep.id)
                    const disabled = !checked && ccIds.size >= CC_MAX
                    return (
                      <label
                        key={rep.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm text-gray-900 dark:text-white cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/40 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleCc(rep.id)}
                          className="rounded border-gray-300 dark:border-gray-500 text-slate-600 focus:ring-slate-500"
                        />
                        <span className="flex-1">
                          {rep.name}
                          <span className="text-gray-500 dark:text-gray-400"> — {rep.title ?? KIND_GROUP_LABEL[rep.kind].replace(/s$/, '')}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {ccIds.size} selected
                </p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                CC other emails (optional)
              </label>
              {ccEmails.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {ccEmails.map(email => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-xs text-gray-800 dark:text-gray-200 max-w-full"
                    >
                      <span className="truncate">{email}</span>
                      <button
                        type="button"
                        onClick={() => removeCcEmail(email)}
                        aria-label={`Remove ${email}`}
                        className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="email"
                  inputMode="email"
                  value={ccEmailInput}
                  onChange={e => { setCcEmailInput(e.target.value); setCcEmailError(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addCcEmail()
                    }
                  }}
                  onBlur={addCcEmail}
                  disabled={ccTotal >= CC_MAX}
                  placeholder="name@company.com"
                  className="flex-1 min-w-0 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={addCcEmail}
                  disabled={!ccEmailInput.trim() || ccTotal >= CC_MAX}
                  className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {ccEmailError ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{ccEmailError}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {ccTotal}/{CC_MAX} total CC recipients
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Note to recipient (optional)
              </label>
              <textarea
                value={repNote}
                onChange={e => setRepNote(e.target.value.slice(0, NOTE_MAX))}
                rows={3}
                placeholder="Anything the recipient should know before reaching out…"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                {repNote.length}/{NOTE_MAX}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode('choose')}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleApproveAndEmail}
                disabled={submitting || !selectedRepId || salesReps.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send & approve'}
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDiscardOpen}
        title="Discard changes?"
        message="You have unsent input on this lead review. Close and discard it?"
        confirmLabel="Discard"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmDiscardOpen(false)
          onClose()
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
      </p>
      <div className="text-gray-900 dark:text-white">{children}</div>
    </div>
  )
}
