/**
 * EdgeGDE — UI Primitive Schema Definitions
 * Phase 10: Self-Assembling Frontend primitives.
 * Zod-validated types for all UI components the LLM can generate.
 *
 * Every incoming JSON config MUST pass through validateUiConfig()
 * before touching TENANT_KV. This is the immutable "Judge" gate.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// ═════════════════════════════════════════════════════════════════════════════
// Style Token Primitives
// ═════════════════════════════════════════════════════════════════════════════

const ColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(.+\)$|^[a-z]+$/)

const SpacingSchema = z.string().regex(/^\d+(px|rem|em|%)$|^auto$/)

const BorderRadiusSchema = z.string().regex(/^\d+px$|^[a-z]+$/)

const FontWeightSchema = z.union([
  z.literal('lighter'),
  z.literal('normal'),
  z.literal('medium'),
  z.literal('semibold'),
  z.literal('bold'),
  z.literal('bolder'),
  z.number().int().min(100).max(900),
])

const FontSizeSchema = z.string().regex(/^\d+(px|rem|em)$/)

const DimensionSchema = z.string().regex(/^\d+(px|rem|em|%|vw|vh)$|^auto$|^fit-content$|^max-content$|^min-content$/)

const TextAlignSchema = z.enum(['left', 'center', 'right', 'justify'])

const FlexDirectionSchema = z.enum(['row', 'column', 'row-reverse', 'column-reverse'])

const JustifyContentSchema = z.enum(['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'])

const AlignItemsSchema = z.enum(['flex-start', 'flex-end', 'center', 'stretch', 'baseline'])

const FlexWrapSchema = z.enum(['nowrap', 'wrap', 'wrap-reverse'])

/** StyleSchema. */
export const StyleSchema = z.object({
  color: ColorSchema.optional(),
  backgroundColor: ColorSchema.optional(),
  padding: SpacingSchema.optional(),
  paddingTop: SpacingSchema.optional(),
  paddingRight: SpacingSchema.optional(),
  paddingBottom: SpacingSchema.optional(),
  paddingLeft: SpacingSchema.optional(),
  margin: SpacingSchema.optional(),
  marginTop: SpacingSchema.optional(),
  marginRight: SpacingSchema.optional(),
  marginBottom: SpacingSchema.optional(),
  marginLeft: SpacingSchema.optional(),
  borderRadius: BorderRadiusSchema.optional(),
  borderWidth: z.string().regex(/^\d+px$/).optional(),
  borderColor: ColorSchema.optional(),
  fontSize: FontSizeSchema.optional(),
  fontWeight: FontWeightSchema.optional(),
  textAlign: TextAlignSchema.optional(),
  width: DimensionSchema.optional(),
  height: DimensionSchema.optional(),
  minWidth: DimensionSchema.optional(),
  maxWidth: DimensionSchema.optional(),
  minHeight: DimensionSchema.optional(),
  maxHeight: DimensionSchema.optional(),
  gap: SpacingSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  boxShadow: z.string().optional(),
  overflow: z.enum(['visible', 'hidden', 'scroll', 'auto']).optional(),
  cursor: z.string().optional(),
})

export type Style = z.infer<typeof StyleSchema>

// ═════════════════════════════════════════════════════════════════════════════
// HTMX Dynamic Attributes
// ═════════════════════════════════════════════════════════════════════════════

const HxAttributesSchema = z.object({
  'hx-get': z.string().optional(),
  'hx-post': z.string().optional(),
  'hx-put': z.string().optional(),
  'hx-patch': z.string().optional(),
  'hx-delete': z.string().optional(),
  'hx-target': z.string().optional(),
  'hx-trigger': z.string().optional(),
  'hx-swap': z.enum(['innerHTML', 'outerHTML', 'beforeend', 'afterbegin', 'beforebegin', 'afterend', 'delete', 'none']).optional(),
  'hx-indicator': z.string().optional(),
  'hx-headers': z.string().optional(),
  'hx-confirm': z.string().optional(),
  'hx-disable': z.boolean().optional(),
  'hx-include': z.string().optional(),
  'hx-params': z.string().optional(),
  'hx-push-url': z.string().optional(),
  'hx-replace-url': z.string().optional(),
  'hx-request': z.string().optional(),
  'hx-select': z.string().optional(),
  'hx-select-oob': z.string().optional(),
  'hx-sync': z.string().optional(),
  'hx-vals': z.string().optional(),
  'hx-boost': z.string().optional(),
  'hx-preserve': z.boolean().optional(),
  'hx-prompt': z.string().optional(),
  'hx-ext': z.string().optional(),
  'hx-history': z.boolean().optional(),
  'hx-history-elt': z.boolean().optional(),
  'mcp-param': z.string().optional(),
  'mcp-action': z.string().optional(),
})

// ═════════════════════════════════════════════════════════════════════════════
// Base Component Schema — every component extends this
// ═════════════════════════════════════════════════════════════════════════════

const BaseComponentSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  style: StyleSchema.optional(),
  className: z.string().optional(),
}).merge(HxAttributesSchema)

// ═════════════════════════════════════════════════════════════════════════════
// Specific Component Schemas
// ═════════════════════════════════════════════════════════════════════════════

export const ContainerSchema = BaseComponentSchema.extend({
  type: z.literal('container'),
  direction: FlexDirectionSchema.optional().default('column'),
  justifyContent: JustifyContentSchema.optional(),
  alignItems: AlignItemsSchema.optional(),
  gap: SpacingSchema.optional(),
  wrap: FlexWrapSchema.optional(),
  children: z.lazy(() => ComponentSchema.array().optional()),
})

/** HeadingSchema. */
export const HeadingSchema = BaseComponentSchema.extend({
  type: z.literal('heading'),
  level: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']).optional().default('h2'),
  text: z.string(),
})

/** TextSchema. */
export const TextSchema = BaseComponentSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  variant: z.enum(['body', 'caption', 'label', 'help']).optional().default('body'),
})

/** ButtonSchema. */
export const ButtonSchema = BaseComponentSchema.extend({
  type: z.literal('button'),
  label: z.string(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'link']).optional().default('primary'),
  size: z.enum(['sm', 'md', 'lg']).optional().default('md'),
  disabled: z.boolean().optional(),
  loading: z.boolean().optional(),
})

/** LinkSchema. */
export const LinkSchema = BaseComponentSchema.extend({
  type: z.literal('link'),
  label: z.string(),
  href: z.string(),
  target: z.enum(['_self', '_blank', '_parent', '_top']).optional().default('_self'),
})

/** TextInputSchema. */
export const TextInputSchema = BaseComponentSchema.extend({
  type: z.literal('text_input'),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  name: z.string(),
  value: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  readonly: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().min(0).optional(),
  pattern: z.string().optional(),
})

/** NumberInputSchema. */
export const NumberInputSchema = BaseComponentSchema.extend({
  type: z.literal('number_input'),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  name: z.string(),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})

/** SelectSchema. */
export const SelectSchema = BaseComponentSchema.extend({
  type: z.literal('select'),
  label: z.string().optional(),
  name: z.string(),
  value: z.string().optional(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
  })).min(1),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
})

/** CheckboxSchema. */
export const CheckboxSchema = BaseComponentSchema.extend({
  type: z.literal('checkbox'),
  label: z.string(),
  name: z.string(),
  checked: z.boolean().optional().default(false),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
})

/** RadioSchema. */
export const RadioSchema = BaseComponentSchema.extend({
  type: z.literal('radio'),
  label: z.string().optional(),
  name: z.string(),
  value: z.string(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
  })).min(1),
  disabled: z.boolean().optional(),
})

/** SliderSchema. */
export const SliderSchema = BaseComponentSchema.extend({
  type: z.literal('slider'),
  label: z.string().optional(),
  name: z.string(),
  value: z.number().optional(),
  min: z.number().optional().default(0),
  max: z.number().optional().default(100),
  step: z.number().positive().optional().default(1),
  showValue: z.boolean().optional().default(true),
  disabled: z.boolean().optional(),
})

/** CardSchema. */
export const CardSchema = BaseComponentSchema.extend({
  type: z.literal('card'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  variant: z.enum(['default', 'elevated', 'outlined', 'glass']).optional().default('default'),
  children: z.lazy(() => ComponentSchema.array().optional()),
})

/** SectionSchema. */
export const SectionSchema = BaseComponentSchema.extend({
  type: z.literal('section'),
  title: z.string().optional(),
  collapsible: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  children: z.lazy(() => ComponentSchema.array().optional()),
})

/** ImageSchema. */
export const ImageSchema = BaseComponentSchema.extend({
  type: z.literal('image'),
  src: z.string().url(),
  alt: z.string().optional(),
  aspectRatio: z.string().optional(),
  objectFit: z.enum(['cover', 'contain', 'fill', 'none', 'scale-down']).optional().default('cover'),
})

/** BadgeSchema. */
export const BadgeSchema = BaseComponentSchema.extend({
  type: z.literal('badge'),
  text: z.string(),
  variant: z.enum(['info', 'success', 'warning', 'danger', 'neutral']).optional().default('neutral'),
  size: z.enum(['sm', 'md']).optional().default('sm'),
  dot: z.boolean().optional(),
})

/** TableSchema. */
export const TableSchema = BaseComponentSchema.extend({
  type: z.literal('table'),
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    sortable: z.boolean().optional(),
    width: DimensionSchema.optional(),
    align: TextAlignSchema.optional(),
  })).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  emptyText: z.string().optional().default('No data'),
  striped: z.boolean().optional().default(false),
  hoverable: z.boolean().optional().default(true),
})

/** FormSchema. */
export const FormSchema = BaseComponentSchema.extend({
  type: z.literal('form'),
  action: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('POST'),
  children: z.lazy(() => ComponentSchema.array().optional()),
  submitLabel: z.string().optional().default('Submit'),
  resetLabel: z.string().optional(),
})

// ═════════════════════════════════════════════════════════════════════════════
// Union — all supported component types
// ═════════════════════════════════════════════════════════════════════════════

export const ComponentSchema: z.ZodType<any> = z.discriminatedUnion('type', [
  ContainerSchema,
  HeadingSchema,
  TextSchema,
  ButtonSchema,
  LinkSchema,
  TextInputSchema,
  NumberInputSchema,
  SelectSchema,
  CheckboxSchema,
  RadioSchema,
  SliderSchema,
  CardSchema,
  SectionSchema,
  ImageSchema,
  BadgeSchema,
  TableSchema,
  FormSchema,
])

// ═════════════════════════════════════════════════════════════════════════════
// Top-Level UI Config — the full config the LLM generates
// ═════════════════════════════════════════════════════════════════════════════

export const UIConfigSchema = z.object({
  version: z.literal('1.0'),
  title: z.string().optional(),
  description: z.string().optional(),
  root: ComponentSchema,
  tokens: z.object({
    primary: ColorSchema.optional(),
    secondary: ColorSchema.optional(),
    accent: ColorSchema.optional(),
    background: ColorSchema.optional(),
    surface: ColorSchema.optional(),
    text: ColorSchema.optional(),
    textMuted: ColorSchema.optional(),
    success: ColorSchema.optional(),
    warning: ColorSchema.optional(),
    danger: ColorSchema.optional(),
    info: ColorSchema.optional(),
    borderRadius: BorderRadiusSchema.optional(),
    fontFamily: z.string().optional(),
  }).optional(),
})

export type UIConfig = z.infer<typeof UIConfigSchema>

// ═════════════════════════════════════════════════════════════════════════════
// Validation Gatekeeper
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Validate an unknown payload against the UIConfigSchema.
 * Returns the parsed config on success.
 * Throws a ZodError on failure — caller should catch and return 400.
 */
export function validateUiConfig(input: unknown): UIConfig {
  return UIConfigSchema.parse(input)
}

/**
 * Validate with safe result — no try/catch needed by caller.
 */
export function validateUiConfigSafe(input: unknown): { success: true; data: UIConfig } | { success: false; error: string } {
  const result = UIConfigSchema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }
}
