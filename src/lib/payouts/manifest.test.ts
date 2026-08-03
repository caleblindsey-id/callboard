import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPayoutManifest, manifestTotals, lockBlockers, lockWarnings } from './manifest'
import type { CommissionReport, CommissionRow } from '@/lib/commission/report-types'

// The manifest is what a period gets PAID from, so its job is to carry every
// source id. A missing id means an ACE entry or a lead never gets closed out;
// a duplicated one means paying twice.

function row(over: Partial<CommissionRow> = {}): CommissionRow {
  return {
    techId: 'tech-1',
    synergyId: '401',
    name: 'Mike Jennings',
    commissionEligible: true,
    role: 'technician',
    labor: {
      labor_shop: 0,
      labor_warranty: 0,
      trip_charge: 0,
      pm_labor: 0,
      diagnostic_fee: 0,
    },
    aceLabor: 0,
    aceEntries: [],
    bonusLeads: [],
    subtotal: 0,
    rate: 0,
    rateIsOverride: false,
    commission: 0,
    pmBonus: 0,
    equipmentBonus: 0,
    total: 0,
    nextTier: null,
    ...over,
  }
}

function report(rows: CommissionRow[], over: Partial<CommissionReport> = {}): CommissionReport {
  return {
    period: '2026-07',
    rows,
    tiers: [],
    totals: { subtotal: 0, commission: 0, bonuses: 0, total: 0 },
    unmappedLabor: [],
    nonTechLabor: 0,
    offRosterRows: [],
    isEmpty: false,
    ...over,
  }
}

test('a tech with no activity contributes no lines at all', () => {
  assert.deepEqual(buildPayoutManifest(report([row()])), [])
})

test('every non-zero labor bucket becomes one basis line, zeros are skipped', () => {
  const lines = buildPayoutManifest(
    report([
      row({
        labor: {
          labor_shop: 4210,
          labor_warranty: 65,
          trip_charge: 637,
          pm_labor: 6047.75,
          diagnostic_fee: 41,
        },
        subtotal: 10959.75,
      }),
    ]),
  )
  const basis = lines.filter((l) => l.kind === 'basis')
  assert.equal(basis.length, 4)
  assert.deepEqual(
    basis.map((l) => l.category),
    ['labor_shop', 'labor_warranty', 'trip_charge', 'pm_labor'],
  )
})

test('diagnostic_fee never reaches the manifest even when non-zero', () => {
  // Ruled 2026-07-31: not commissioned, not the technician's number. July is
  // the first month it carried real values, which is why this is pinned.
  const lines = buildPayoutManifest(
    report([
      row({
        labor: {
          labor_shop: 100,
          labor_warranty: 0,
          trip_charge: 0,
          pm_labor: 0,
          diagnostic_fee: 250,
        },
        subtotal: 100,
      }),
    ]),
  )
  assert.equal(
    lines.some((l) => (l.category as string) === 'diagnostic_fee'),
    false,
  )
})

test('each ACE entry becomes its own line carrying its source id', () => {
  const lines = buildPayoutManifest(
    report([
      row({
        aceLabor: 810,
        aceEntries: [
          { id: 'ace-a', hours: 0.75, rate: 120, value: 90, approvedAt: null, reason: 'Rental unit' },
          { id: 'ace-b', hours: 1.5, rate: 120, value: 180, approvedAt: null, reason: null },
        ],
        subtotal: 810,
      }),
    ]),
  )
  const ace = lines.filter((l) => l.category === 'ace_labor')
  assert.equal(ace.length, 2)
  assert.deepEqual(ace.map((l) => l.source_id), ['ace-a', 'ace-b'])
  assert.equal(ace.every((l) => l.source_kind === 'ace_labor_entry'), true)
})

test('each earned lead becomes its own bonus line, split by lead type', () => {
  const lines = buildPayoutManifest(
    report([
      row({
        pmBonus: 250,
        equipmentBonus: 100,
        subtotal: 5000,
        bonusLeads: [
          { id: 'lead-pm', leadType: 'pm', customer: 'ACME', equipment: 'Viper', amount: 250, earnedAt: null },
          {
            id: 'lead-eq',
            leadType: 'equipment_sale',
            customer: 'Cullman County Bd Of Ed',
            equipment: 'Walk-Behind Scrubber',
            amount: 100,
            earnedAt: null,
          },
        ],
      }),
    ]),
  )
  const bonus = lines.filter((l) => l.kind === 'bonus')
  assert.deepEqual(bonus.map((l) => l.category), ['pm_bonus', 'equipment_bonus'])
  assert.deepEqual(bonus.map((l) => l.source_id), ['lead-pm', 'lead-eq'])
  assert.equal(bonus.every((l) => l.source_kind === 'tech_lead'), true)
})

test('the commission line freezes the rate and the subtotal it was chosen from', () => {
  // The tier is a cliff on the whole subtotal, so a boundary dispute has to be
  // settleable from the one row without re-summing anything.
  const lines = buildPayoutManifest(
    report([row({ subtotal: 7921.75, rate: 0.075, commission: 594.13 })]),
  )
  const c = lines.find((l) => l.kind === 'commission')
  assert.ok(c)
  assert.equal(c.amount, 594.13)
  assert.equal(c.rate_at_lock, 0.075)
  assert.equal(c.basis_subtotal_at_lock, 7921.75)
})

test('a non-commissioned tech is still locked, at 0%, with the reason recorded', () => {
  // 407 Verberne: $6,316.75 of real labor that pays nothing. The workbook has
  // always carried him, so the snapshot must too, or the two cannot reconcile.
  const lines = buildPayoutManifest(
    report([
      row({
        techId: 'tech-407',
        synergyId: '407',
        name: 'Jeff Verberne',
        commissionEligible: false,
        labor: {
          labor_shop: 2221,
          labor_warranty: 0,
          trip_charge: 1176,
          pm_labor: 2919.75,
          diagnostic_fee: 0,
        },
        subtotal: 6316.75,
        rate: 0,
        commission: 0,
      }),
    ]),
  )
  const c = lines.find((l) => l.kind === 'commission')
  assert.ok(c)
  assert.equal(c.amount, 0)
  assert.equal(c.rate_at_lock, 0)
  assert.equal(c.basis_subtotal_at_lock, 6316.75)
  assert.match(c.note ?? '', /not commission eligible/i)
})

test('a bonus with no labor still produces lines', () => {
  // A lead can earn in a month the tech billed nothing, and the bonus is flat.
  const lines = buildPayoutManifest(
    report([
      row({
        pmBonus: 275,
        bonusLeads: [
          { id: 'lead-1', leadType: 'pm', customer: 'ABM', equipment: null, amount: 275, earnedAt: null },
        ],
      }),
    ]),
  )
  assert.equal(lines.filter((l) => l.kind === 'bonus').length, 1)
  assert.equal(lines.filter((l) => l.kind === 'commission').length, 1)
})

test('a row with no techId is skipped rather than writing a null FK', () => {
  assert.deepEqual(buildPayoutManifest(report([row({ techId: null, subtotal: 5000 })])), [])
})

test('exactly one commission line per tech', () => {
  const lines = buildPayoutManifest(
    report([
      row({ techId: 't1', subtotal: 5000, commission: 250 }),
      row({ techId: 't2', subtotal: 3000, commission: 75 }),
    ]),
  )
  assert.equal(lines.filter((l) => l.kind === 'commission').length, 2)
})

test('no source id appears twice — paying twice is the failure this prevents', () => {
  const lines = buildPayoutManifest(
    report([
      row({
        techId: 't1',
        subtotal: 300,
        aceEntries: [
          { id: 'ace-a', hours: 1, rate: 120, value: 120, approvedAt: null, reason: null },
        ],
        bonusLeads: [
          { id: 'lead-a', leadType: 'pm', customer: null, equipment: null, amount: 100, earnedAt: null },
        ],
      }),
      row({
        techId: 't2',
        subtotal: 300,
        aceEntries: [
          { id: 'ace-b', hours: 1, rate: 120, value: 120, approvedAt: null, reason: null },
        ],
      }),
    ]),
  )
  const ids = lines.map((l) => l.source_id).filter(Boolean)
  assert.equal(new Set(ids).size, ids.length)
})

test('manifest totals are recomputed from the lines, bonuses after the percentage', () => {
  const lines = buildPayoutManifest(
    report([
      row({ techId: 't1', subtotal: 8450.75, rate: 0.075, commission: 633.81, pmBonus: 0, equipmentBonus: 100,
        bonusLeads: [{ id: 'l1', leadType: 'equipment_sale', customer: null, equipment: null, amount: 100, earnedAt: null }] }),
      row({ techId: 't2', subtotal: 11769.75, rate: 0.1, commission: 1176.98 }),
    ]),
  )
  assert.deepEqual(manifestTotals(lines), {
    commission: 1810.79,
    bonuses: 100,
    total: 1910.79,
  })
})

test('July 2026 reproduces the workbook: $4,208.12 commission + $100 bonus', () => {
  // The month verified penny-exact against Synergy and the Phocas dashboard on
  // 2026-08-03. If the manifest ever stops summing to this, it is wrong.
  const july: [string, string, number, number, number, number][] = [
    // techId, synergyId, subtotal, rate, commission, bonus
    ['t401', '401', 11769.75, 0.1, 1176.98, 0],
    ['t402', '402', 15053.75, 0.1, 1505.38, 0],
    ['t403', '403', 8450.75, 0.075, 633.81, 100],
    ['t404', '404', 430.5, 0, 0, 0],
    ['t407', '407', 6316.75, 0, 0, 0],
    ['t408', '408', 4605.0, 0.025, 115.12, 0],
    ['t409', '409', 3611.0, 0.025, 90.28, 0],
    ['t410', '410', 6538.25, 0, 0, 0],
    ['t411', '411', 9154.0, 0.075, 686.55, 0],
    ['t444', '444', 120.0, 0, 0, 0],
  ]
  const lines = buildPayoutManifest(
    report(
      july.map(([techId, synergyId, subtotal, rate, commission, bonus]) =>
        row({
          techId,
          synergyId,
          commissionEligible: rate > 0 || ['401', '402', '403', '404', '408', '409', '411'].includes(synergyId),
          subtotal,
          rate,
          commission,
          equipmentBonus: bonus,
          bonusLeads: bonus
            ? [{ id: `lead-${synergyId}`, leadType: 'equipment_sale', customer: null, equipment: null, amount: bonus, earnedAt: null }]
            : [],
        }),
      ),
    ),
  )
  assert.deepEqual(manifestTotals(lines), {
    commission: 4208.12,
    bonuses: 100,
    total: 4308.12,
  })
})

test('lockBlockers refuses an unsynced period', () => {
  assert.equal(lockBlockers(report([], { isEmpty: true })).length, 1)
})

test('lockBlockers refuses labor attributed to an unknown Synergy code', () => {
  // That code could be a real technician nobody mapped. Locking would freeze
  // their labor out of the period permanently.
  const b = lockBlockers(report([], { unmappedLabor: [{ synergyId: '412', amount: 900 }] }))
  assert.equal(b.length, 1)
  assert.match(b[0], /412/)
})

test('lockBlockers passes a clean period', () => {
  assert.deepEqual(lockBlockers(report([row({ subtotal: 5000 })])), [])
})

test('off-roster activity warns but does not block', () => {
  const rep = report([row({ subtotal: 5000 })], {
    offRosterRows: [row({ techId: 'mgr', synergyId: null, name: 'Tim Adams', role: 'manager', aceLabor: 240 })],
  })
  assert.deepEqual(lockBlockers(rep), [])
  const w = lockWarnings(rep)
  assert.equal(w.length, 1)
  assert.match(w[0], /Tim Adams/)
  assert.match(w[0], /NOT included/)
})
