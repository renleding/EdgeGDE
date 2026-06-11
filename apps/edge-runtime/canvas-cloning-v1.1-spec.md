# Pixel-Perfect Website Cloning — Specification v1.1

## Current state
The v1 cloner (`src/cloner/website-cloner.ts`) is a lightweight HTML parser that extracts structure, text, and inline styles. It produces an editable CanvasDocument but the visual output does **not** match the original page because:

- External CSS is not fetched or resolved
- JavaScript-rendered content is not captured
- Flex/grid layouts are not inferred
- Computed styles (from browser rendering) are not available
- Responsive breakpoints are not handled
- Custom fonts are not detected
- Pseudo-elements are invisible in the DOM

## Goal
Achieve pixel-perfect (or near-pixel-perfect) cloning such that compiling the CanvasDocument produces HTML that is visually indistinguishable from the original page at a desktop viewport (1440px).

---

## 1. Architecture: Two-Pass Cloner

The current single-pass (fetch → parse → output) is insufficient. Pixel-perfect requires **browser-level computed style extraction**, which means a headless browser.

```
PASS 1 — Server (Cloudflare Worker)
  Fetch HTML + CSS
  Parse document tree
  Identify structure
  → Produces rough CanvasDocument (current v1)

PASS 2 — Browser (Headless via CF Browser Rendering API or external)
  Load page in headless Chromium
  Wait for full JS execution + font loading
  Extract getComputedStyle() for every element
  Capture layout metrics (bounding rects, flex/grid info)
  Capture computed pseudo-elements
  → Returns style map + layout data

MERGE — Combine passes
  Apply computed styles to CanvasDocument nodes
  Infer flex/grid layout from bounding rects + computed display
  Extract design tokens (colors, fonts, spacing)
  Download images to R2
  → Produces near-pixel-perfect CanvasDocument
```

---

## 2. Detailed Component Specifications

### 2.1 CSS Resolution Engine

**Location:** `src/cloner/css-resolver.ts`

**Input:** Array of CSS URLs from `<link>` tags + inline `<style>` blocks

**Pipeline:**

```
Fetch CSS files (parallel, max 5 concurrent)
  ↓
Parse each into rule list (cssom or regex-based parser)
  ↓
Resolve @import chains (recursive, max depth 3)
  ↓
Match rules to elements by selector
  ↓
Compute final style per element (cascade + specificity)
  ↓
Output: Map<elementId, Record<string, string>>
```

**CSS parser requirement:** Must handle:
- Standard selectors (class, ID, tag, attribute, descendant, child, sibling)
- `@media` queries (ignore — we're targeting 1440px desktop)
- `@keyframes` — extract names but don't apply
- `@font-face` — extract font family names + URLs
- `@import` — inline the imported sheet
- Custom properties (`var(--name)`) — resolve from `:root` or parent

**Cascade resolution:**

```ts
interface ResolvedStyle {
  // From CSS rules matched to this element
  properties: Record<string, string>
  // Source for debugging
  source: Map<string, { rule: string; specificity: number }>
}
```

Algorithm:
1. Collect all rules matching the element (by selector)
2. Sort by specificity (ID > class > tag > universal)
3. Apply in order (last wins for same specificity, `!important` reverses)
4. Resolve `var()` references using the computed style of the element's ancestors + `:root`
5. Convert all values to canonical form (e.g., `#ff0000` → `rgb(255,0,0)`, `2em` → `32px` at root)

**Complexity:** This is the hardest component. A full CSS cascade engine is equivalent to a browser's style system. For v1.1, scope to the most common properties:

| Group | Properties | Priority |
|-------|-----------|----------|
| Layout | display, position, flex*, grid*, margin, padding, width, height | P0 |
| Typography | font-family, font-size, font-weight, line-height, text-align, color | P0 |
| Background | background-color, background-image, background-size | P0 |
| Border | border-radius, border-color, border-width | P1 |
| Visual | opacity, box-shadow, transform | P1 |
| Other | overflow, z-index, cursor | P2 |

### 2.2 Browser Rendering Adapter

**Location:** `src/cloner/browser-adapter.ts`

**Purpose:** Extract computed styles and layout metrics via a headless browser.

**Options (in priority order):**

| Option | Pros | Cons |
|--------|------|------|
| **CF Browser Rendering API** | Native Workers integration, no external infra | Requires paid plan, regional availability, 30s timeout per render |
| **External Playwright service** | Full control, no timeout limits | Extra infra, latency |
| **Fallback: Server-side only** | Works today, no new infra | No JS rendering, less accurate |

**Browser adapter interface:**

```ts
interface BrowserResult {
  /** Per-element computed styles */
  computedStyles: Map<string, Record<string, string>>
  /** Layout metrics from getBoundingClientRect */
  layouts: Map<string, { x: number; y: number; width: number; height: number; flexDirection?: string; gap?: number }>
  /** Computed pseudo-elements */
  pseudoStyles: Map<string, { before?: Record<string, string>; after?: Record<string, string> }>
  /** Detected font faces */
  fonts: Array<{ family: string; url: string; weight?: string; style?: string }>
  /** Page title after JS execution */
  title: string
}
```

**Execution flow:**
1. Launch headless browser at 1440px viewport
2. Navigate to URL, wait for `networkidle`
3. Inject extraction script:
   ```js
   function extractComputedStyles() {
     const results = {}
     const allElements = document.querySelectorAll('*')
     for (const el of allElements) {
       const id = el.id || el.getAttribute('data-node-id') || generateId(el)
       results[id] = {
         computed: window.getComputedStyle(el),
         rect: el.getBoundingClientRect(),
         pseudoBefore: window.getComputedStyle(el, '::before'),
         pseudoAfter: window.getComputedStyle(el, '::after'),
         tagName: el.tagName,
         classList: Array.from(el.classList),
         text: el.textContent?.slice(0, 200),
         innerHtml: el.innerHTML?.slice(0, 500),
       }
     }
     return results
   }
   ```
4. Serialize and return results
5. Close browser

### 2.3 Layout Inference Engine

**Location:** `src/cloner/layout-inference.ts`

**Purpose:** Convert flat bounding rect data into CanvasDocument's flex-based layout model.

**Input:** Map of element IDs with computed styles + bounding rects
**Output:** Parent-child relationships + flex properties

**Algorithm:**

```
For each element with children:
  1. Collect child bounding rects
  2. Determine layout axis:
     - If children share similar Y positions AND varying X → flexDirection: "row"
     - If children share similar X positions AND varying Y → flexDirection: "column"
     - If both vary → grid-like, degrade to column
  3. Calculate gap:
     - For row: median of (child[i+1].left - child[i].right)
     - For column: median of (child[i+1].top - child[i].bottom)
  4. Detect wrapping:
     - If child row extends past parent width → flexWrap: "wrap"
  5. Detect alignment:
     - If children centered in parent → alignItems: "center"
     - If children stretch to parent width → alignItems: "stretch"
  6. Assign flex properties:
     - flexGrow: proportional to child width / total children width
     - flexShrink: 1 (default)
     - order: based on visual order (left-to-right, top-to-bottom)
```

**Accuracy target:** 90%+ of layouts should be correctly inferred for common patterns (nav bars, card grids, hero sections, footers).

### 2.4 Design Token Extraction

**Location:** `src/cloner/design-token-extractor.ts`

**Purpose:** Identify a cohesive design system from the extracted styles.

**Output:** An EDR-compatible design token definition.

```ts
interface DesignTokens {
  colors: {
    background: string      // Most common background
    text: string            // Most common text color
    primary: string         // Most common accent/link color
    surface: string         // Card/surface background
    border: string          // Most common border color
    muted: string            // Secondary text color
  }
  typography: {
    fontFamily: string
    fontSize: Record<string, string>  // h1, h2, h3, body, small
    fontWeight: Record<string, number>
    lineHeight: number
  }
  spacing: {
    unit: number            // Base spacing unit (4, 8, etc.)
    padding: Record<string, string>
    gap: string
    borderRadius: string
  }
}
```

**Algorithm:**
1. Collect all unique color values from computed styles
2. Cluster by frequency → most common = background, text, primary
3. Collect all font sizes → detect heading hierarchy
4. Collect all spacing values → detect base unit (gcd of common values)
5. Collect border radii → most common = default

### 2.5 Image Asset Pipeline

**Location:** `src/cloner/asset-pipeline.ts`

**Purpose:** Download images to R2 and rewrite URLs.

**Current state:** Images are hotlinked (reference original URL).
**Target state:** Images are downloaded to R2, URLs rewritten in CanvasDocument.

**Flow:**
1. During clone, collect all `src` attributes from `<img>`, `<source>`, `<picture>`
2. Also check CSS `background-image: url(...)`
3. Fetch each image (parallel, max 10 concurrent, max 5MB per image)
4. Store in R2 at `tenant:{tenantId}:canvas:{canvasId}:assets:{filename}`
5. Rewrite CanvasDocument node `props.src` to R2 URL
6. For background images, rewrite style property

**Optimizations:**
- Skip images < 100 bytes (likely tracking pixels)
- Skip images hosted on same domain (already available)
- Cache by URL hash to avoid duplicates
- Timeout: 10s per image

---

## 3. Data Model Changes

### 3.1 CanvasDocument additions

```ts
interface CanvasDocument {
  // ... existing fields ...
  
  // NEW: Captured during clone
  cloneMetadata?: {
    sourceUrl: string
    capturedAt: number
    viewportWidth: number      // 1440 default
    jsExecuted: boolean
    cssResolved: boolean
    imagesDownloaded: boolean
    styleFidelity: 'structure_only' | 'approximate' | 'pixel_perfect'
  }
  
  // NEW: Extracted design tokens (for EDR compilation)
  designTokens?: DesignTokens
}
```

### 3.2 Node additions

```ts
interface Node {
  // ... existing fields ...
  
  // NEW: For pseudo-elements
  pseudoElements?: {
    before?: Record<string, any>
    after?: Record<string, any>
  }
}
```

---

## 4. Compiler Changes

The current `compileFromCanvas` outputs inline styles. Pixel-perfect output requires:

### 4.1 CSS-in-`<head>` support

The compiled HTML should include a `<style>` block in `<head>` generated from:
- Design tokens as CSS custom properties
- Extracted `@font-face` rules
- Shared repetitive styles (rather than repeating them inline on every node)

### 4.2 Font loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
```

Font families detected during clone should be loaded in the compiled HTML. For Google Fonts, use the Google Fonts API. For self-hosted fonts, embed the `@font-face` declarations.

### 4.3 Responsive output (future)

If the clone captured multiple viewports, the compiler should produce:
```css
@media (max-width: 768px) {
  .canvas-node-xxx { flex-direction: column; }
}
```

---

## 5. Implementation Phases

| Phase | What | Effort | Depends on |
|-------|------|--------|------------|
| **1.1a** | CSS resolver (server-side, no cascade) | 1-2 days | — |
| **1.1b** | Browser adapter + computed style extraction | 2-3 days | CF Browser Rendering or external browser |
| **1.1c** | Layout inference engine | 1-2 days | 1.1a + 1.1b |
| **1.1d** | Design token extraction | 0.5 days | 1.1a |
| **1.1e** | Image asset pipeline | 1 day | R2 bucket |
| **1.1f** | Compiler: <head> CSS + font support | 0.5 days | 1.1d |
| **1.1g** | Full cascade CSS engine | 3-4 days | 1.1a |
| **1.2** | Pseudo-element support | 1 day | 1.1b |
| **1.3** | Responsive clone + output | 2 days | 1.1b + 1.1f |

**Total estimated effort:** 12-17 days for a single developer.

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CSS cascade engine complexity | High | High | Scope to common properties first. Use a library if available (stylis, css-tree). |
| Browser Rendering API availability | Medium | High | Fall back to server-side only. Accept lower fidelity. |
| Site uses JS rendering (React/Next.js) | Very High | High | Browser adapter required. Without it, these sites will always be incomplete. |
| Large page with thousands of elements | Medium | Medium | Cap element count at 500. Skip off-screen or hidden elements. |
| Copyright concerns with cloned assets | Low | Medium | Always hotlink by default. Download to R2 only with explicit user consent. |
| Font licensing restrictions | Low | Low | Only reference origin font URLs. Don't re-host fonts. |

---

## 7. Success Metrics

| Metric | Current (v1) | Target (v1.1) | Method |
|--------|-------------|---------------|--------|
| Visual similarity | ~20% | >85% | Side-by-side pixel diff |
| Layout structure | ~40% | >90% | Element count + hierarchy match |
| Color accuracy | ~30% | >95% | Computed color comparison on sample of 50 elements |
| Font accuracy | ~10% | >90% | Font family + size match |
| Image fidelity | Hotlinked | >95% | Image present + correct dimensions |
| Clone time | <1s | <30s | Wall clock |
| Canvas size (nodes) | 20-50 | 50-200 | Appropriate for page complexity |

---

## 8. Architectural Decision: Library vs Build

| Component | Build vs Buy | Recommendation |
|-----------|-------------|---------------|
| HTML parser | Build (done in v1) | ✅ Keep existing, fix script-skip bug |
| CSS parser | **Library** | Use `css-tree` (already in npm, works in Workers). Avoid building a CSS parser from scratch. |
| CSS cascade | Build scoped | Full cascade is browser-level complex. Build for P0 properties only, defer edge cases. |
| Browser automation | **Service** | CF Browser Rendering API or external Playwright. Don't run a browser inside Workers. |
| Layout inference | Build | Proprietary logic. No library exists for this. |
| Design token extraction | Build | Heuristic + frequency analysis. ~200 lines. |
