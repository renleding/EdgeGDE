/**
 * EdgeGDE — Document Intelligence Ingest Route Test (Stub)
 *
 * Verifies the ingestRouter module can be imported and its type is correct.
 * Comprehensive tests to be added: file upload validation, MIME type filtering,
 * R2 storage, classification, OCR pipeline integration.
 *
 * @todo Full test coverage for ingest route handlers
 */

import { describe, it, expect } from 'vitest'
import { ingestRouter } from '../../../../../src/api/doc-intel/routes/ingest'

describe('ingestRouter', () => {
  it('exports a Hono router', () => {
    expect(ingestRouter).toBeDefined()
    expect(ingestRouter.fetch).toBeInstanceOf(Function)
  })
})
