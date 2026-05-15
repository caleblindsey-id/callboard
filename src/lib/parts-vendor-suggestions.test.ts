import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestVendor } from './parts-vendor-suggestions'

test('suggestVendor returns null for empty / missing descriptions', () => {
  assert.equal(suggestVendor(null), null)
  assert.equal(suggestVendor(undefined), null)
  assert.equal(suggestVendor(''), null)
})

test('suggestVendor matches case-insensitively', () => {
  assert.equal(suggestVendor('Replacement Thermostat'), 'HVAC Express')
  assert.equal(suggestVendor('REPLACEMENT THERMOSTAT'), 'HVAC Express')
})

test('suggestVendor maps compressors and condensing units to Air Hydraulics', () => {
  assert.equal(suggestVendor('5-ton compressor'), 'Air Hydraulics')
  assert.equal(suggestVendor('condensing unit'), 'Air Hydraulics')
  assert.equal(suggestVendor('evaporator coil'), 'Air Hydraulics')
})

test('suggestVendor maps controls to HVAC Express', () => {
  assert.equal(suggestVendor('control board'), 'HVAC Express')
  assert.equal(suggestVendor('digital thermostat'), 'HVAC Express')
})

test('suggestVendor maps general mechanicals to Grainger', () => {
  assert.equal(suggestVendor('drive belt'), 'Grainger')
  assert.equal(suggestVendor('idler pulley'), 'Grainger')
  assert.equal(suggestVendor('blower motor'), 'Grainger')
})

test('suggestVendor maps filters and strainers to Imperial Dade Stock', () => {
  assert.equal(suggestVendor('air filter'), 'Imperial Dade Stock')
  assert.equal(suggestVendor('water strainer'), 'Imperial Dade Stock')
})

test('suggestVendor returns null when nothing matches', () => {
  assert.equal(suggestVendor('mystery part XYZ-9000'), null)
  assert.equal(suggestVendor('grommet kit'), null)
})

test('suggestVendor prefers compressor over motor when both keywords appear', () => {
  // "compressor motor" should bias to the more specific HVAC vendor, not
  // generic Grainger — the compressor rule is listed first for this reason.
  assert.equal(suggestVendor('compressor motor'), 'Air Hydraulics')
})

test('suggestVendor matches substrings inside larger descriptions', () => {
  assert.equal(
    suggestVendor('OEM replacement thermostat for RTU-3'),
    'HVAC Express',
  )
})
