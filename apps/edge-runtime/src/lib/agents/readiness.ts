/**
 * EdgeGDE — Readiness Agent
 * Deterministic constraint evaluator: checks KYC + required documents.
 * Pure function — no I/O, no randomness, no time dependency.
 */

export interface ReadinessInput {
  kycStatus: string
  documentRecords: string[]
}

export interface ReadinessOutput {
  readinessStatus: 'blocked' | 'incomplete' | 'ready'
  missingDocuments: string[]
}

const REQUIRED_DOCUMENTS = ['passport', 'payslip']

export function computeReadiness(input: ReadinessInput): ReadinessOutput {
  const { kycStatus, documentRecords } = input
  const normalizedDocs = documentRecords.map(d => d.toLowerCase().trim())

  if (kycStatus !== 'verified') {
    return {
      readinessStatus: 'blocked',
      missingDocuments: REQUIRED_DOCUMENTS.filter(d => !normalizedDocs.includes(d)),
    }
  }

  const missingDocuments = REQUIRED_DOCUMENTS.filter(d => !normalizedDocs.includes(d))

  if (missingDocuments.length > 0) {
    return { readinessStatus: 'incomplete', missingDocuments }
  }

  return { readinessStatus: 'ready', missingDocuments: [] }
}
