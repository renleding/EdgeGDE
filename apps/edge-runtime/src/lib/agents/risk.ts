/**
 * EdgeGDE — Risk Agent
 * Deterministic rule engine: evaluates KYC status + debt ratio + affordability.
 * Pure function — no I/O, no randomness, no time dependency.
 */

export interface RiskInput {
  kycStatus: string
  debtRatio: number
  affordabilityScore: number
}

export interface RiskOutput {
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
}

export function computeRisk(input: RiskInput): RiskOutput {
  const { kycStatus, debtRatio, affordabilityScore } = input

  let score = 1.0

  if (kycStatus !== 'verified') score -= 0.3
  if (debtRatio > 0.8) score -= 0.3
  if (affordabilityScore < 0.5) score -= 0.2

  const clamped = Math.max(0, Math.min(1, parseFloat(score.toFixed(4))))

  let riskLevel: 'low' | 'medium' | 'high'
  if (clamped > 0.7) riskLevel = 'low'
  else if (clamped > 0.4) riskLevel = 'medium'
  else riskLevel = 'high'

  return { riskScore: clamped, riskLevel }
}
