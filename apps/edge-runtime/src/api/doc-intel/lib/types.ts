/**
 * EdgeGDE — Document Intelligence Shared Types
 *
 * @packageDocumentation
 */

/** Supported tenant identifiers */
export type DocIntelTenant = 'personal' | 'afirmico'

/** Job lifecycle status */
export type JobStatus =
  | 'pending'
  | 'claimed'
  | 'processing'
  | 'retry_pending'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'

/** Document OCR status */
export type OcrStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'

/** Error classification for job failures */
export type ErrorClassification =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'VALIDATION'
  | 'SECURITY'

/** Data classification for fields */
export type DataClassification =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED'

/** Profile type */
export type ProfileType = 'personal' | 'client'

/** Activity types */
export type ActivityType =
  | 'upload'
  | 'ocr'
  | 'extraction'
  | 'validation'
  | 'encryption'
  | 'form_population'
  | 'doc_generation'
  | 'crm_update'
  | 'salestrekker_update'

/** Audit stage types */
export type AuditStage =
  | 'upload'
  | 'ocr'
  | 'extraction'
  | 'validation'
  | 'encryption'
  | 'form_population'
  | 'doc_generation'
  | 'crm_update'
  | 'salestrekker_update'

/** Audit status */
export type AuditStatus = 'started' | 'completed' | 'failed' | 'pending_approval'

/** Document type (classification) */
export type DocumentType =
  | 'passport'
  | 'licence'
  | 'medicare'
  | 'payslip'
  | 'bank_statement'

/** An extracted field with encryption metadata */
export interface ExtractedField {
  name: string
  value: string         // Plaintext value (encrypted before storage)
  confidence: number
  classification: DataClassification
}

/** Job claim request */
export interface ClaimRequest {
  worker_id: string
}

/** Job result submission */
export interface JobResult {
  job_id: string
  status: JobStatus
  document_type: DocumentType
  confidence: number
  fields: ExtractedField[]
  ocr_r2_key: string
  fields_r2_key: string
  compressed_r2_key?: string
  compressed_size_bytes?: number
  original_size_bytes: number
  duration_ms: number
  error?: string
  error_classification?: ErrorClassification
}

/** Heartbeat update */
export interface HeartbeatRequest {
  job_id: string
}

/** Audit log event (API response shape) */
export interface AuditEvent {
  audit_id: string
  workflow_id: string
  document_id: string | null
  profile_id: string | null
  stage: string
  status: string
  duration_ms: number | null
  created_at: number
}

/** Document search result */
export interface DocumentSearchResult {
  document_id: string
  document_type: string
  filename_display: string
  ocr_status: string
  confidence: number | null
  created_at: number
}

/** Standard API error response */
export interface ApiError {
  error: string
  code: string
  detail?: string
}
