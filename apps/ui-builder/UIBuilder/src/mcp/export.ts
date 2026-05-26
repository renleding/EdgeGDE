/**
 * OpenPencil — Design Artifact Export
 * HSAES Phase 6: Exports the current OpenPencil design as a DesignArtifact
 * that can be published to the EdgeGDE runtime.
 *
 * @packageDocumentation
 */

import { SCHEMA_VERSION } from '@edgegde/schema'
import type { LayoutDefinition } from '@edgegde/schema'

// ═══════════════════════════════════════════════════════════════════════════
// DesignArtifact Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignArtifact {
  id: string
  type: 'page' | 'calculator' | 'theme'
  layout: LayoutDefinition
  schema?: Record<string, unknown>
  theme?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════
// exportCurrentDesign
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the current OpenPencil page/selection and export it as a DesignArtifact.
 *
 * In the current implementation, this returns a static mortgage calculator
 * artifact as a reference/sample. Future implementations will use the
 * OpenPencil MCP tools to read the actual current page and selection.
 */
export function exportCurrentDesign(): DesignArtifact {
  // For now, export a static mortgage calculator artifact as reference
  return {
    id: 'mortgage',
    type: 'calculator',
    layout: {
      schemaVersion: SCHEMA_VERSION,
      rootNode: {
        id: 'mortgage-form',
        type: 'FRAME',
        name: 'Mortgage Calculator',
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        children: [
          {
            id: 'principal-field',
            type: 'TEXT',
            name: 'Loan Amount',
            x: 20,
            y: 20,
            width: 560,
            height: 28,
          },
          {
            id: 'interest-field',
            type: 'TEXT',
            name: 'Interest Rate',
            x: 20,
            y: 60,
            width: 560,
            height: 28,
          },
          {
            id: 'term-field',
            type: 'TEXT',
            name: 'Loan Term',
            x: 20,
            y: 100,
            width: 560,
            height: 28,
          },
          {
            id: 'submit-btn',
            type: 'RECTANGLE',
            name: 'Calculate',
            x: 20,
            y: 150,
            width: 120,
            height: 44,
          },
          {
            id: 'results-area',
            type: 'FRAME',
            name: 'Results',
            x: 20,
            y: 220,
            width: 560,
            height: 160,
          },
        ],
      },
      formFields: [
        {
          nodeId: 'principal-field',
          label: 'Loan Amount',
          fieldType: 'number',
          placeholder: 'e.g. 500000',
          required: true,
          min: 1000,
          max: 10000000,
        },
        {
          nodeId: 'interest-field',
          label: 'Interest Rate',
          fieldType: 'number',
          placeholder: 'e.g. 6.25',
          required: true,
          min: 0.1,
          max: 25,
          step: 0.01,
        },
        {
          nodeId: 'term-field',
          label: 'Loan Term (years)',
          fieldType: 'number',
          placeholder: 'e.g. 30',
          required: true,
          min: 1,
          max: 40,
        },
      ],
      submitButton: {
        nodeId: 'submit-btn',
        label: 'Calculate',
      },
      resultDisplay: {
        nodeId: 'results-area',
        type: 'card',
      },
    },
    schema: {
      principal: { type: 'number', description: 'Loan amount in AUD' },
      interestRate: { type: 'number', description: 'Annual interest rate (%)' },
      loanTerm: { type: 'number', description: 'Loan term in years' },
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenPencil MCP Integration (future)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Future implementation: read current page from OpenPencil and convert to artifact.
 *
 * This would call the OpenPencil MCP tools:
 *   - getCurrentPage() to get the current page name and ID
 *   - getPageTree() to get the node hierarchy
 *   - getSelection() if a specific selection should be exported
 *   - describe() for semantic node descriptions
 *
 * Then convert the OpenPencil nodes into a LayoutDefinition with form fields,
 * submit button, and result display derived from the design structure.
 */
// export async function exportOpenPencilCurrentDesign(): Promise<DesignArtifact> {
//   const pageInfo = await getCurrentPage()
//   const pageTree = await getPageTree()
//   const selection = await getSelection()
//
//   return convertToArtifact(pageInfo, pageTree, selection)
// }
