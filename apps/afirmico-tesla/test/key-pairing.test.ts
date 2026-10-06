/**
 * Tests for virtual-key state reconciliation (FRS-010 F02-R16).
 *
 * The property under test is that our record follows Tesla in BOTH directions.
 *
 * The bug this pins down: only the upgrade (`unpaired` -> `paired`) was ever
 * written. Once a vehicle was marked paired it was never polled again, because
 * the pollers filtered on `key_state IN (NULL,'unpaired')`. So when an owner
 * removed the virtual key at the car, our record kept asserting `paired`
 * indefinitely while the vehicle silently stopped streaming -- and every surface
 * we show (dashboard, admin overview, `tesla_vehicle_key`) agreed with the wrong
 * answer.
 *
 * Observed live: vehicle `5YJ3F7EB7LF697834` held `key_state='paired'` and a
 * telemetry config row in state `active`, while Tesla reported
 * `unpaired_vins: ["5YJ3F7EB7LF697834"]` and `key_paired: false`.
 */

import { describe, expect, it } from 'vitest'
import { resolveKeyState } from '../src/key-pairing'

describe('virtual key state reconciliation (F02-R16)', () => {
  it('records paired when Tesla reports the key present', () => {
    expect(resolveKeyState(true, false)).toEqual({ state: 'paired', lastError: null })
  })

  it('records unpaired when Tesla reports no key and no config', () => {
    // A vehicle whose key was never added. The config is absent too, which is
    // what distinguishes this from a removed key.
    expect(resolveKeyState(false, false)).toEqual({
      state: 'unpaired',
      lastError: 'key_not_paired_at_tesla',
    })
  })

  it('records unpaired_by_owner when the key was removed at the car', () => {
    // Key gone but the telemetry config still present: the key existed and was
    // deliberately removed. Distinct from "never paired" so an operator prompt
    // can differ.
    expect(resolveKeyState(false, true)).toEqual({
      state: 'unpaired_by_owner',
      lastError: 'key_removed_by_owner',
    })
  })

  it('never reports paired for a vehicle Tesla reports as unpaired', () => {
    // The regression itself: a downgrade must be representable. Both unpaired
    // inputs must produce a non-paired state, whichever way the owner left it.
    for (const byOwner of [false, true]) {
      expect(resolveKeyState(false, byOwner).state).not.toBe('paired')
    }
  })

  it('clears last_error once the key is paired again', () => {
    // Re-pairing must not leave a stale failure reason behind, which would make
    // a healthy vehicle look faulted on the admin surface.
    expect(resolveKeyState(true, false).lastError).toBeNull()
  })

  it('only ever returns a state the schema permits', () => {
    // tesla_vehicle_key.key_state CHECK: ('unpaired','paired','fault','unpaired_by_owner')
    const permitted = new Set(['unpaired', 'paired', 'fault', 'unpaired_by_owner'])
    for (const paired of [true, false]) {
      for (const byOwner of [true, false]) {
        expect(permitted.has(resolveKeyState(paired, byOwner).state)).toBe(true)
      }
    }
  })
})
