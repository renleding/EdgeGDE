/**
 * EdgeGDE — compileLayout Compatibility Layer
 *
 * Drop-in replacement for the legacy compileLayout function.
 * Converts OpenPencil LayoutDefinition → CanvasDocument → compiled HTML.
 *
 * This allows registry callers to switch to the new pipeline
 * without any caller-side changes.
 *
 * @packageDocumentation
 */

import { openPencilToCanvas } from '../canvas/openpencil-migration'
import { compileFromCanvas } from '../canvas/compile-from-canvas'

/**
 * Legacy-compatible compileLayout that delegates to the Canvas pipeline.
 * Accepts the same (layout, design?) signature as the deprecated compiler.
 *
 * @param layout - OpenPencil LayoutDefinition
 * @param _design - (Unused) Design tokens — CanvasDocument auto-extracts
 * @returns Compiled HTML string
 */
export function compileLayoutCompat(
  layout: any,
  _design?: any,
): string {
  const doc = openPencilToCanvas(layout)
  return compileFromCanvas(doc)
}
