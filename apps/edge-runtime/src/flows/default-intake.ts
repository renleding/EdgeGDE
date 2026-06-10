/**
  * EdgeGDE — Default Intake Flow (Blueprint-Compatible)
  *
  * Wraps the tenant's blueprint field schema as a flow contract.
  * Fields are loaded from the blueprint config at runtime — NOT hardcoded.
  * Used as the initial flow when no flowStack exists.
  *
  * Packs: au_mortgage (rules), au_nccp (compliance)
  */

 export interface FlowContract {
   flowId: string
   type: 'intake' | 'advisory' | 'compliance' | 'remediation'
   scope: 'public' | 'secure'
   requiresAuth: boolean
   totalWeight: { fields: number; docs: number; compliance: number }
   insights: Array<{ insightId: string; triggersFlowId: string; type: string; scope: string; requiresAuth: boolean }>
 }

 /**
  * Returns the default intake flow contract.
  * Fields are resolved dynamically from the tenant's blueprint at session init.
  * This contract defines the flow metadata only — field definitions come from KV.
  */
 export function getDefaultIntakeFlow(): FlowContract {
   return {
     flowId: 'mortgage_intake',
     type: 'intake',
     scope: 'public',
     requiresAuth: false,
     totalWeight: { fields: 40, docs: 40, compliance: 20 },
     insights: [
       { insightId: 'fhog_precheck', triggersFlowId: 'fhog_formal_assessment', type: 'compliance', scope: 'secure', requiresAuth: true },
       { insightId: 'refinance_opportunity', triggersFlowId: 'refinance_assessment', type: 'compliance', scope: 'secure', requiresAuth: true },
       { insightId: 'investment_capacity', triggersFlowId: 'investment_validation', type: 'compliance', scope: 'secure', requiresAuth: true },
     ],
   }
 }

 export const identityFields = new Set(['fullName', 'email', 'phone'])
