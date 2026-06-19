/**
 * EdgeGDE — Drift Detector
 * Compares a tenant's running config against its blueprint baseline
 * (with Zod defaults applied). Reports differences as drift entries.
 *
 * Baseline = applyDefaults(blueprint) not raw blueprint.
 * This prevents every tenant from showing "drift" on default values.
 */

import { Blueprint, BlueprintSchema } from '../blueprint/blueprint.schema'
import { ChatConfigSchema } from '../../lib/chat-config'

export interface DriftEntry {
  path: string
  expected: unknown
  actual: unknown
}

// ═══════════════════════════════════════════════════════════════════════════
// Detect drift between blueprint baseline and tenant config
// ═══════════════════════════════════════════════════════════════════════════

function buildExpectedPackVersions(blueprint: Blueprint): Record<string, string> {
  const packVersions: Record<string, string> = {}
  if (blueprint.packs?.rule_pack) {
    const { name, version } = blueprint.packs.rule_pack
    packVersions.rules = `${name}_v${version.replace(/^v/, '')}`
  }
  if (blueprint.packs?.compliance_pack) {
    const { name, version } = blueprint.packs.compliance_pack
    packVersions.compliance = `${name}_v${version.replace(/^v/, '')}`
  }
  return packVersions
}

export function detectConfigDrift(
  blueprint: Blueprint,
  tenantConfig: Record<string, unknown>,
  tenantOverrides?: Record<string, unknown>,
): DriftEntry[] {
  // Build baseline: compile blueprint through Zod (applies defaults)
  const baseline = BlueprintSchema.parse(blueprint) as Record<string, unknown>

  // Also build expected chat config (same as factory would)
  const expectedConfig: Record<string, unknown> = {
    objective: `${(blueprint as any).name || blueprint.id} — Customer intake`,
    fields: blueprint.fields,
    priorityOrder: blueprint.priorityOrder,
    rules: [],
    knowledgeBase: { topics: ['rates', 'products', 'policy', 'fees', 'compliance', 'general'] },
    ui: {
      title: (blueprint as any).name || blueprint.id,
      greeting: `Welcome to ${(blueprint as any).name || blueprint.id}! Let's get started with your application.`,
      colorAccent: '#58a6ff',
    },
    pack_versions: buildExpectedPackVersions(blueprint),
  }

  // Apply tenant overrides to baseline for comparison
  if (tenantOverrides) {
    applyDefaults(expectedConfig, tenantOverrides)
  }

  // Compare using ChatConfigSchema defaults
  const drift: DriftEntry[] = []
  comparePaths('', expectedConfig, tenantConfig, drift)
  return drift
}

// ═══════════════════════════════════════════════════════════════════════════
// Compare two objects recursively, recording differences
// ═══════════════════════════════════════════════════════════════════════════

function comparePaths(
  prefix: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  drift: DriftEntry[],
): void {
  // Check keys in expected that differ in actual
  for (const key of Object.keys(expected)) {
    const path = prefix ? `${prefix}.${key}` : key
    const expVal = expected[key]
    const actVal = actual[key]

    if (actVal === undefined) {
      drift.push({ path, expected: expVal, actual: undefined })
    } else if (
      typeof expVal === 'object' && !Array.isArray(expVal) &&
      typeof actVal === 'object' && !Array.isArray(actVal) &&
      expVal !== null && actVal !== null
    ) {
      comparePaths(path, expVal as Record<string, unknown>, actVal as Record<string, unknown>, drift)
    } else if (JSON.stringify(expVal) !== JSON.stringify(actVal)) {
      drift.push({ path, expected: expVal, actual: actVal })
    }
  }

  // Check keys in actual that don't exist in expected (added fields)
  for (const key of Object.keys(actual)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (expected[key] === undefined) {
      drift.push({ path, expected: undefined, actual: actual[key] })
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Apply overrides to a baseline (for comparison purposes)
// ═══════════════════════════════════════════════════════════════════════════

function applyDefaults(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): void {
  for (const key of Object.keys(override)) {
    const baseVal = base[key]
    const overrideVal = override[key]
    if (
      typeof baseVal === 'object' && !Array.isArray(baseVal) &&
      typeof overrideVal === 'object' && !Array.isArray(overrideVal) &&
      baseVal !== null && overrideVal !== null
    ) {
      applyDefaults(baseVal as Record<string, unknown>, overrideVal as Record<string, unknown>)
    } else {
      base[key] = overrideVal
    }
  }
}