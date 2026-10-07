/**
 * The derivation-version invariant: one DERIVATION_VERSION = one derivation behaviour.
 *
 * WHY THIS FILE IS SHAPED THIS WAY
 *
 * A test that failed merely because `PENDING_DERIVATION_CHANGES` is non-empty would be
 * red on every PR until the bump landed — blocking unrelated work to enforce a known,
 * accepted deferral. That is the wrong shape, because a non-empty list can be a
 * deliberate state, not a mistake.
 *
 * So this fails on DRIFT instead: a change that has become `effective` while the version
 * still equals the one it was declared against. That is the real failure — the behaviour
 * changed and nobody moved the version — and it fails loudly.
 */
import { describe, it, expect } from 'vitest'
import { DERIVATION_VERSION, PENDING_DERIVATION_CHANGES } from '../src/derive'

describe('DERIVATION_VERSION', () => {
  it('is a semver string, so a bump is legible in a package', () => {
    expect(DERIVATION_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is 1.1.0: Trim in the segment, and the FSD share refused across mismatched spans', () => {
    // Pinned deliberately. Both changes on 2026-10-07 alter what a derived profile can
    // contain, so both are covered by this one version; changing either without moving
    // the version should require a considered edit here.
    expect(DERIVATION_VERSION).toBe('1.1.0')
  })
})

describe('pending derivation changes (the drift guard)', () => {
  it('has no entry that became effective without the version moving', () => {
    for (const pending of PENDING_DERIVATION_CHANGES) {
      const drifted =
        pending.effective && DERIVATION_VERSION === pending.declaredAgainstVersion
      expect(
        drifted,
        `"${pending.change}" is marked effective but DERIVATION_VERSION is still ` +
          `${pending.declaredAgainstVersion}. The behaviour changed without the version ` +
          `moving, so two behaviours now share one version. Bump DERIVATION_VERSION.`,
      ).toBe(false)
    }
  })

  it('every entry is well formed, so the list cannot be hollowed out to silence it', () => {
    for (const pending of PENDING_DERIVATION_CHANGES) {
      expect(typeof pending.effective, 'effective must be a boolean').toBe('boolean')
      expect(pending.change.trim().length, 'change must be named').toBeGreaterThan(0)
      expect(pending.note.trim().length, 'note must explain what changes and why').toBeGreaterThan(20)
      expect(pending.declaredAgainstVersion).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('is empty after the 2026-10-07 bundle, and says so', () => {
    // The owner chose option C: bundle the bump WITH the change. That landed, so nothing
    // is pending. A future non-empty list is legitimate — it is how a known change is
    // carried — but it should be a conscious act, so this assertion makes it visible.
    expect(PENDING_DERIVATION_CHANGES).toHaveLength(0)
  })
})
