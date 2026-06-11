# EdgeGDE Website Transpiler — Specification v2.1

## Core Principle

The transpiler **imports content structure** and **infers a design identity** from the source, then encodes both into the **EdgeGDE native format**. The output is a CanvasDocument with an attached **EdgeGDE Design System** that captures the source's visual character. The result:

- Looks like the original site's **design personality** (colors, typography, feel)
- Renders through EdgeGDE's **flex-based, responsive layout engine**
- Is **fully editable** and **instantly re-themeable** by swapping design tokens
- Is **responsive** across desktop, tablet, and mobile

```
Source HTML
    ↓
Transpiler
    ├── Stage 1: Parse content structure from HTML
    ├── Stage 2: Infer design tokens from source inline/computed styles
    ├── Stage 3: Build responsive CanvasDocument (3 viewports)
    └── Stage 4: Attach EdgeGDE Design System (tokens + breakpoints)
    ↓
CanvasDocument
    ├── nodes (content, desktop layout)
    ├── responsiveOverrides (tablet + mobile layout diffs)
    └── designTokens (source-derived color/font/spacing system)
    ↓
compileFromCanvas()
    ├── Applies design tokens as CSS custom properties
    ├── Outputs media queries from responsiveOverrides
    └── Produces responsive, styled EdgeGDE-native HTML
```

---

## 1. Design Token Extraction (source → EdgeGDE tokens)

Instead of discarding source styles or copying CSS rules, the transpiler **analyzes the source** and infers a **coherent design token set**. These tokens are stored in the CanvasDocument and drive the compiler output.

### 1.1 Token inference algorithm

```
For each meaningful element in the parsed HTML:

COLORS:
  1. Collect all inline `color`, `background-color`, `border-color` values
  2. Cluster by frequency → identify palette roles
     - Most common background → colors.background
     - Most common text color → colors.text
     - Most common accent/link color → colors.primary
     - Most common surface/card bg → colors.surface
     - Most common muted text → colors.muted
  3. Fallback to EdgeGDE defaults if source has no inline styles

TYPOGRAPHY:
  1. Collect all font-family, font-size, font-weight values from inline styles
  2. Group by semantic role:
     - h1 text → typography.fontSize.h1, typography.fontWeight.h1
     - h2 text → typography.fontSize.h2
     - body text → typography.fontSize.body
  3. Most frequent font-family → typography.fontFamily

SPACING:
  1. Collect all padding, margin, gap, border-radius values
  2. Find GCD of common values → spacing.baseUnit
  3. Most common border-radius → spacing.borderRadius

RESULT: DesignTokens object attached to CanvasDocument
```

### 1.2 The DesignTokens type

```ts
interface DesignTokens {
  colors: {
    background: string        // Page background
    surface: string           // Card/section background
    text: string              // Primary text
    textMuted: string         // Secondary/muted text
    primary: string           // Accent/links/CTAs
    border: string            // Borders
    success?: string          // Optional success state
    danger?: string           // Optional error state
  }
  typography: {
    fontFamily: string
    fontSize: {
      h1: string              // 36px default
      h2: string              // 24px default
      h3: string              // 20px default
      body: string            // 16px default
      small: string           // 13px default
    }
    fontWeight: {
      h1: number
      h2: number
      h3: number
      body: number
    }
    lineHeight: number
  }
  spacing: {
    baseUnit: number          // 4 or 8 typically
    sectionPadding: string
    cardPadding: string
    gap: string
    borderRadius: string
  }
  breakpoints: {
    desktop: number           // 1440px
    tablet: number            // 768px
    mobile: number            // 375px
  }
}
```

### 1.3 Source vs default

| Extraction result | Behavior |
|-------------------|----------|
| Source has inline colors | Used to populate DesignTokens |
| Source has no styles | EdgeGDE defaults applied |
| Source has partial styles (e.g., colors but no fonts) | Missing tokens filled from EdgeGDE defaults |
| Source has too many unique values (>20 colors) | Top 5 most frequent used, rest defaulted |

This guarantees every cloned site has a **complete, valid design system** — never partial or broken.

---

## 2. Responsive Model: Three-Viewport Capture

### 2.1 Current limitation

CanvasDocument has a single `style: Record<string, any>` per node. This is desktop-only (1440px).

### 2.2 Responsive extension

```ts
interface Node {
  // ...existing fields...
  style: Record<string, any>    // Desktop styles (applied at ≥ desktop breakpoint)

  // NEW
  responsiveOverrides?: {
    tablet?: Record<string, any>   // Overrides at tablet breakpoint
    mobile?: Record<string, any>   // Overrides at mobile breakpoint
  }
}
```

### 2.3 How responsive data is captured

**During clone (two-pass):**

```
PASS 1: Desktop (1440px width)
  → Extract full node tree + desktop layout
  → Store in node.style

PASS 2: Tablet (768px width)
  → Re-fetch same URL
  → Compare layout to desktop
  → Store DIFF in node.responsiveOverrides.tablet

PASS 3: Mobile (375px width)
  → Same process
  → Store DIFF in node.responsiveOverrides.mobile
```

Each pass runs the HTML parser on the same URL. Since we're not resolving CSS, the HTML is the same — only the responsive structure changes (which elements are visible, their order, etc.). For JS-heavy sites where HTML differs per viewport, three separate server-side fetches capture the variations.

### 2.4 How the compiler outputs responsive CSS

```ts
// For each node with responsiveOverrides:
function compileNode(node): string {
  const desktop = inlineStyles(node.style)
  const tablet = node.responsiveOverrides?.tablet
    ? `@media (max-width: 768px) { #${node.id} { ${inlineStyles(tablet)} } }`
    : ''
  const mobile = node.responsiveOverrides?.mobile
    ? `@media (max-width: 375px) { #${node.id} { ${inlineStyles(mobile)} } }`
    : ''
  return `<div id="${node.id}" style="${desktop}">...</div>
          <style>${tablet}${mobile}</style>`
}
```

All media query styles are collected into a single `<style>` block in `<head>` for performance.

### 2.5 Development workflow

When editing a canvas, the user can switch viewports in the editor:

```
[Desktop 1440px] [Tablet 768px] [Mobile 375px]    ← viewport toggle
```

Editing in any viewport stores changes in the appropriate `style` or `responsiveOverrides` bucket. The other viewports inherit desktop styles unless explicitly overridden.

---

## 3. Design System as Single Source of Truth

### 3.1 Token-driven compilation

The compiler does NOT hardcode styles. It reads design tokens from the CanvasDocument and applies them:

```
compileFromCanvas(doc):
  1. Read doc.designTokens
  2. For each node, compute final style:
     - Start with EdgeGDE defaults for the node's type/role
     - Override with doc.designTokens values
     - Override with node.style (explicit user edits)
  3. Emit CSS custom properties in <head> from designTokens
  4. Emit inline styles on each node
  5. Emit media queries from responsiveOverrides
```

### 3.2 Instant re-theming

Because every node's style is derived from `designTokens`, changing the design system re-styles the entire canvas:

```ts
// User picks a new theme in the editor
canvas.designTokens = LIGHT_THEME

// Re-compile → all nodes get new colors, fonts, spacing
compileFromCanvas(canvas)
```

No per-node editing required. The theme swap is O(1) — one token object change → entire site re-styled.

### 3.3 Design token presets

The editor ships with built-in design presets:

| Preset | Description |
|--------|-------------|
| `edgegde-dark` (default) | Dark theme, blue accent |
| `edgegde-light` | Light theme, blue accent |
| `minimal-dark` | Dark theme, minimal gray palette |
| `minimal-light` | Light theme, minimal gray palette |
| `corporate` | Blue/white corporate theme |
| `creative` | Bold accent colors |
| `source-derived` | Auto-detected from cloned source |

The `source-derived` preset is what the transpiler creates during clone. Users can switch to any preset at any time.

---

## 4. Updated Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CANVAS DOCUMENT                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  nodes[]                                              │   │
│  │  ├── Page (root)                                      │   │
│  │  │   ├── Section(hero)   style={...}                  │   │
│  │  │   │   └── Text(h1)    style={...}                  │   │
│  │  │   │       responsiveOverrides={                    │   │
│  │  │   │         tablet: { fontSize: "28px" },          │   │
│  │  │   │         mobile:  { fontSize: "22px" }          │   │
│  │  │   │       }                                        │   │
│  │  │   ├── Section(features)                            │   │
│  │  │   └── Section(footer)                              │   │
│  │  └── ...                                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  designTokens                                         │   │
│  │  { colors, typography, spacing, breakpoints }         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  cloneMetadata (source: "factory.ai", captured at)  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  compileFromCanvas(doc)                                      │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ designTokens│───▶│ Node styles  │───▶│ Responsive     │  │
│  │ → CSS vars  │    │ → inline     │    │ → media qrys   │  │
│  └─────────────┘    └──────────────┘    └────────────────┘  │
│                                                             │
│  ▼                                                          │
│  <html>                                                     │
│    <head>                                                   │
│      <style>                                                │
│        :root {                                              │
│          --bg: #0d1117;       ← from designTokens          │
│          --text: #e1e4e8;                                   │
│          --font-family: 'Inter', sans-serif;                 │
│        }                                                    │
│        @media (max-width: 768px) { ... }   ← responsive    │
│        @media (max-width: 375px) { ... }                    │
│      </style>                                               │
│    </head>                                                  │
│    <body>                                                   │
│      <main>                                                 │
│        <section style="background: var(--bg)">...</section> │
│      </main>                                                │
│    </body>                                                  │
│  </html>                                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Compiler Changes Required

### 5.1 Design token passthrough

`compileFromCanvas()` signature change:

```ts
export function compileFromCanvas(
  doc: CanvasDocument,
  edr?: EDR,
  presetTheme?: DesignTokens,  // NEW: optional theme override
): string
```

- If `doc.designTokens` exists, use them. If `presetTheme` is provided, it overrides.
- If neither exists, use EdgeGDE defaults.

### 5.2 CSS custom property generation

```ts
function compileDesignTokens(tokens: DesignTokens): string {
  return `
:root {
  --bg: ${tokens.colors.background};
  --surface: ${tokens.colors.surface};
  --text: ${tokens.colors.text};
  --text-muted: ${tokens.colors.textMuted};
  --primary: ${tokens.colors.primary};
  --border: ${tokens.colors.border};
  --font-family: ${tokens.typography.fontFamily};
  --line-height: ${tokens.typography.lineHeight};
  --radius: ${tokens.spacing.borderRadius};
  --gap: ${tokens.spacing.gap};
}
@media (max-width: ${tokens.breakpoints.tablet}px) {
  :root { --section-padding: 40px 20px; --h1-size: 28px; }
}
@media (max-width: ${tokens.breakpoints.mobile}px) {
  :root { --section-padding: 20px 16px; --h1-size: 22px; }
}`
}
```

### 5.3 Responsive override compilation

```ts
function compileResponsiveOverrides(node: Node): string {
  let css = ''
  const bp = { tablet: 768, mobile: 375 }  // from designTokens

  if (node.responsiveOverrides?.tablet) {
    css += `@media (max-width: ${bp.tablet}px) {#${node.id}{${serializeStyle(node.responsiveOverrides.tablet)}}}`
  }
  if (node.responsiveOverrides?.mobile) {
    css += `@media (max-width: ${bp.mobile}px) {#${node.id}{${serializeStyle(node.responsiveOverrides.mobile)}}}`
  }
  return css
}
```

### 5.4 Responsive overrides in the editor

When a user edits a node in tablet or mobile viewport, the editor:

1. Detects which viewport is active
2. Stores the edit in `node.responsiveOverrides.tablet` or `.mobile`
3. Does NOT modify `node.style` (desktop baseline is preserved)
4. On viewport switch, recompiles with the appropriate responsive bucket

---

## 6. Migration Path (from current v1)

| Change | File | Effort |
|--------|------|--------|
| Add `designTokens` to CanvasDocument type | `src/canvas/canvas-types.ts` | 15 min |
| Add `responsiveOverrides` to Node type | `src/canvas/canvas-types.ts` | 15 min |
| Build Design Token Extractor | `src/transpiler/design-extractor.ts` (new) | 1 day |
| Build three-viewport clone flow | Update `src/cloner/website-cloner.ts` | 1 day |
| Update `compileFromCanvas` for tokens + responsive | `src/canvas/compile-from-canvas.ts` | 4 hours |
| Add theme presets | `src/canvas/design-presets.ts` (new) | 2 hours |
| Add viewport toggle to editor UI | `src/routes/canvas-editor.ts` | 4 hours |
| Update tests | `tests/` | 4 hours |

**Total:** ~3-4 days

---

## 7. Summary: What This Enables

| Capability | How it works | Value |
|-----------|-------------|-------|
| **Clone preserves visual identity** | Source inline styles → design token inference → EdgeGDE token system | Site looks like the original but is fully editable |
| **Responsive output** | 3-pass clone → responsiveOverrides per node → media queries in compiled CSS | Works on all devices out of the box |
| **Instant re-theming** | All styles derived from `designTokens` — swap tokens, recompile | Change entire site look in one click |
| **Design system switch** | Six built-in presets + source-derived | From "looks like factory.ai" to "looks like EdgeGDE light" in one action |
| **Agent edits respect theme** | Agent outputs mutations, compiler applies tokens | AI changes content, not design |
| **100% deterministic** | No CSS cascade, no browser, no JS execution | Same input → same output, always |
