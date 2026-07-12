/**
 * EdgeGDE — Document Intelligence Error Module Tests
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import { ErrorCode, VALID_TENANTS, errorBody, errorResponse } from '../../../../../src/api/doc-intel/lib/errors'

describe('doc-intel error codes', () => {
  it('exports well-known error codes', () => {
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
    expect(ErrorCode.MISSING_TENANT).toBe('MISSING_TENANT')
    expect(ErrorCode.INVALID_TENANT).toBe('INVALID_TENANT')
    expect(ErrorCode.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE')
    expect(ErrorCode.INVALID_FILE_TYPE).toBe('INVALID_FILE_TYPE')
    expect(ErrorCode.JOB_NOT_FOUND).toBe('JOB_NOT_FOUND')
    expect(ErrorCode.JOB_ALREADY_CLAIMED).toBe('JOB_ALREADY_CLAIMED')
    expect(ErrorCode.DOCUMENT_NOT_FOUND).toBe('DOCUMENT_NOT_FOUND')
    expect(ErrorCode.PROFILE_NOT_FOUND).toBe('PROFILE_NOT_FOUND')
    expect(ErrorCode.ENCRYPTION_FAILED).toBe('ENCRYPTION_FAILED')
    expect(ErrorCode.KEY_NOT_FOUND).toBe('KEY_NOT_FOUND')
    expect(ErrorCode.INVALID_INPUT).toBe('INVALID_INPUT')
  })

  it('exports valid tenant values', () => {
    expect(VALID_TENANTS).toEqual(['personal', 'afirmico'] as const)
  })
})

describe('errorBody', () => {
  it('returns a body and status for a known error code', () => {
    const result = errorBody('MISSING_TENANT', 'x-tenant header is required')
    expect(result.status).toBe(400)
    expect(result.body).toEqual({
      error: 'MISSING_TENANT',
      code: 'MISSING_TENANT',
      detail: 'x-tenant header is required',
    })
  })

  it('returns 500 for unknown error code', () => {
    const result = errorBody('UNKNOWN_CODE')
    expect(result.status).toBe(500)
    expect(result.body.code).toBe('UNKNOWN_CODE')
  })

  it('returns detail as undefined when omitted', () => {
    const result = errorBody('INTERNAL_ERROR')
    expect(result.body.detail).toBeUndefined()
  })

  it('returns 404 for DOCUMENT_NOT_FOUND', () => {
    const result = errorBody('DOCUMENT_NOT_FOUND', 'Doc 123 not found')
    expect(result.status).toBe(404)
    expect(result.body.detail).toBe('Doc 123 not found')
  })

  it('returns 409 for JOB_ALREADY_CLAIMED', () => {
    const result = errorBody('JOB_ALREADY_CLAIMED')
    expect(result.status).toBe(409)
  })

  it('returns 413 for FILE_TOO_LARGE', () => {
    const result = errorBody('FILE_TOO_LARGE')
    expect(result.status).toBe(413)
  })
})

describe('errorResponse', () => {
  it('returns a Response with correct status code', () => {
    const res = errorResponse('MISSING_TENANT')
    expect(res.status).toBe(400)
  })

  it('returns a Response with JSON content type', () => {
    const res = errorResponse('INTERNAL_ERROR')
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('includes error details in response body', async () => {
    const res = errorResponse('INVALID_INPUT', 'Bad data')
    const body = await res.json()
    expect(body).toEqual({
      error: 'INVALID_INPUT',
      code: 'INVALID_INPUT',
      detail: 'Bad data',
    })
  })
})
