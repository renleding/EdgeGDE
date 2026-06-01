/**
 * EdgeGDE — UI Schema Registry
 * Hybrid: loads static schemas from bundle, falls back to TENANT_KV for overrides.
 *
 * @packageDocumentation
 */

import intakeForm from '../../ui-config/origination/origination_intake_form.json'
import pipelineView from '../../ui-config/origination/broker_pipeline_view.json'
import appCard from '../../ui-config/origination/application_card_component.json'
import uploadDoc from '../../ui-config/origination/document_upload_component.json'
import pipelineCard from '../../ui-config/origination/application_pipeline_card.json'

export const STATIC_SCHEMAS: Record<string, any> = {
  'origination_intake_form': intakeForm,
  'broker_pipeline_view': pipelineView,
  'application_card_component': appCard,
  'document_upload_component': uploadDoc,
  'application_pipeline_card': pipelineCard,
}

/**
 * Load a UI schema — static bundle first, then KV fallback.
 * The KV fallback enables tenant-specific overrides without re-deploying.
 */
export async function loadSchema(env: any, name: string, tenantId?: string): Promise<any> {
  // 1. Check static bundle
  if (STATIC_SCHEMAS[name]) return STATIC_SCHEMAS[name]

  // 2. Fallback to TENANT_KV
  if (tenantId && env?.TENANT_KV) {
    try {
      const key = `tenant:${tenantId}:schema:v1:${name}`
      return await env.TENANT_KV.get(key, 'json')
    } catch {}
  }

  return null
}
