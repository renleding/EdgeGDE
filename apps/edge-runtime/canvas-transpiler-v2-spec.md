# EdgeGDE Website Transpiler — Specification v2.0

## Core Principle
The transpiler does **not** clone visual appearance. It **imports content structure** into the EdgeGDE native format. The output is a CanvasDocument that, when compiled, produces an **EdgeGDE-native website** — not a replica of the source.

```
Source HTML → Transpiler → CanvasDocument → compileFromCanvas → EdgeGDE-native HTML
                              ↕
                        (editable, versioned, agent-controllable)
```

The transpiler is the single ingestion pipeline for ALL external content:
- Cloned websites (any URL)
- Prompt-generated sites (via LLM)
- Legacy OpenPencil layouts (via migration)
- Raw HTML fragments
- Template imports

---

## 1. Architecture: Single Transpiler Pipeline

```
                    ┌─────────────────────┐
                    │    INPUT SOURCE      │
                    │  (HTML/URL/Prompt)   │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   STAGE 1: PARSE    │
                    │  Extract semantic   │
                    │  content tree       │
                    │  (no CSS, no JS)    │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   STAGE 2: MAP      │
                    │  HTML elements →    │
                    │  EdgeGDE components │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   STAGE 3: COMPOSE  │
                    │  Build CanvasDoc    │
                    │  Apply EdgeGDE      │
                    │  design tokens      │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   CanvasDocument    │
                    │  (EdgeGDE-native)   │
                    └─────────────────────┘
```

**Key invariant:** The output is always an EdgeGDE-native CanvasDocument. The source's visual design (colors, fonts, spacing, layout) is **discarded** — only the content hierarchy and semantic structure are preserved.

---

## 2. Stage 1: Semantic HTML Parser

**File:** `src/transpiler/html-parser.ts` (replaces `src/cloner/website-cloner.ts`)

The parser already exists and works for basic structure. Required improvements:

### 2.1 Structural element identification

Map HTML structural elements to EdgeGDE component types:

| HTML element(s) | EdgeGDE component | Notes |
|----------------|-------------------|-------|
| `<header>`, `[role=banner]` | `Section` with `props.role = "header"` | Top navigation region |
| `<nav>`, `[role=navigation]` | `Section` with `props.role = "nav"` | Navigation links |
| `<main>`, `[role=main]`, `<article>` | Automatically merged into Page | Primary content |
| `<section>`, `[role=region]` | `Section` | Content grouping |
| `<footer>`, `[role=contentinfo]` | `Section` with `props.role = "footer"` | Footer region |
| `<h1>-<h6>` | `Text` with `props.level` | Heading hierarchy preserved |
| `<p>`, `<div>` with text | `Text` | Paragraph content |
| `<ul>`, `<ol>`, `<li>` | `Frame` (container) + `Text` (items) | List structure |
| `<img>`, `<picture>` | `Frame` with `props.src`, `props.alt` | Images |
| `<a>` | `Text` with `props.href` | Links |
| `<form>` | `Frame` with `props.role = "form"` | Forms |
| `<input>`, `<textarea>`, `<select>` | `Input` | Form fields |
| `<button>`, `[type=submit]` | `Button` | Actions |

### 2.2 Content extraction rules

- **Strip:** `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<svg>`, `<canvas>`, comments, hidden elements (`display:none`, `visibility:hidden`, `hidden` attribute)
- **Extract:** `alt` text from images, `aria-label` from interactive elements, `placeholder` from inputs
- **Collapse:** Inline elements (`<span>`, `<strong>`, `<em>`, `<b>`, `<i>`, `<u>`, `<code>`) — merge text into parent node
- **Preserve hierarchy:** Document outline from heading levels (h1 → h2 → h3)

### 2.3 Text normalization

- Strip excessive whitespace (collapse multiple spaces, trim)
- Normalize Unicode (NFKC)
- Truncate very long text nodes (>500 chars → split into multiple Text nodes)

---

## 3. Stage 2: EdgeGDE Component Mapping

**File:** `src/transpiler/component-mapper.ts`

### 3.1 Page structure templates

The transpiler organizes content into standard EdgeGDE page sections:

```
Page
├── Section (role: "header")
│   ├── Frame (logo + site title)
│   └── Frame (navigation links → Text nodes)
├── Section (role: "hero")
│   ├── Text (h1 → props.text, props.level: 1)
│   ├── Text (subtitle → props.text, props.level: 2)
│   └── Button (CTA if present)
├── Section (role: "features") [if multiple content groups]
│   ├── Frame (feature card)
│   │   ├── Text (heading)
│   │   └── Text (description)
│   └── Frame (feature card)
│       ├── Text (heading)
│       └── Text (description)
├── Section (role: "content") [general content]
│   └── Text (paragraphs)
├── Frame (role: "form") [if form present]
│   ├── Input (fields)
│   └── Button (submit)
└── Section (role: "footer")
    ├── Text (links)
    └── Text (copyright)
```

### 3.2 Detection heuristics

| Pattern | Detected as | Logic |
|---------|-------------|-------|
| `<header>` with `<nav>` + logo | Header section | Structural tag |
| First `<section>` with `<h1>` + `<p>` + `<a>/<button>` | Hero section | First major content block with heading + CTA |
| Multiple `<section>`/`<div>` siblings with heading + text | Feature cards | 2+ sibling containers with heading + description pattern |
| `<form>` with inputs | Form section | Form element detection |
| `<footer>` with links | Footer section | Structural tag |
| Deep `<ul>`/`<li>` nesting | Navigation | Found inside `<nav>` or `header` |

### 3.3 Content-based section naming

Section `name` and `props.label` are derived from the first heading in the section, or a heuristic:
- First section without clear heading → `"hero"`
- Section with h2 "Features" → `"features"`
- Section with h2 "Pricing" → `"pricing"`
- Section with form → `"contact"`
- Last section → `"footer"`

---

## 4. Stage 3: EdgeGDE Design Application

**File:** `src/transpiler/design-applier.ts`

### 4.1 Default design tokens

Every cloned site gets the standard EdgeGDE dark theme:

```ts
const EDGEGDE_DESIGN = {
  colors: {
    background: '#0d1117',
    surface: '#1c2128',
    text: '#e1e4e8',
    textMuted: '#8b949e',
    accent: '#58a6ff',
    success: '#238636',
    danger: '#f85149',
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: { h1: '36px', h2: '24px', h3: '20px', body: '16px', small: '13px' },
    fontWeight: { h1: 700, h2: 600, h3: 600, body: 400 },
    lineHeight: 1.5,
  },
  spacing: {
    sectionPadding: '60px 40px',
    cardPadding: '20px',
    gap: '16px',
    borderRadius: '8px',
  },
}
```

### 4.2 Token application rules

| Node type | Default styles applied |
|-----------|----------------------|
| Page | `backgroundColor: #0d1117` |
| Section (header) | `padding: 16px 40px`, `backgroundColor: #1c2128`, `display: flex` |
| Section (hero) | `padding: 80px 40px`, `display: flex`, `flexDirection: column`, `alignItems: center`, `textAlign: center` |
| Section (features) | `padding: 60px 40px`, `display: flex`, `gap: 20px` |
| Section (footer) | `padding: 40px`, `backgroundColor: #0d1117`, `textAlign: center`, `color: #8b949e` |
| Text (h1) | `fontSize: 36px`, `fontWeight: 700`, `color: #f0f6fc` |
| Text (h2) | `fontSize: 24px`, `fontWeight: 600`, `color: #f0f6fc` |
| Text (body) | `fontSize: 16px`, `lineHeight: 1.6`, `color: #e1e4e8` |
| Frame (card) | `padding: 20px`, `backgroundColor: #1c2128`, `borderRadius: 8px` |
| Input | `padding: 12px 16px`, `backgroundColor: #0d1117`, `border: 1px solid #2d3140`, `borderRadius: 6px`, `color: #e1e4e8` |
| Button | `padding: 10px 24px`, `backgroundColor: #238636`, `color: #fff`, `borderRadius: 6px`, `border: none` |

---

## 5. Component Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     TRANSPILER INDEX                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  src/transpiler/                                            │
│  ├── html-parser.ts          Stage 1: Parse HTML→tree      │
│  ├── component-mapper.ts     Stage 2: Tree→EdgeGDE map     │
│  ├── design-applier.ts       Stage 3: Apply design tokens  │
│  └── transpile.ts            Orchestrator (public API)      │
│                                                             │
│  Replaces:                                                  │
│  src/cloner/website-cloner.ts    (removed)                  │
│  src/generator/layout-generator.ts (uses same components)   │
│                                                             │
│  Consumes:                                                  │
│  src/canvas/canvas-types.ts                                 │
│  src/canvas/canvas-engine.ts   (for getTree validation)     │
│                                                             │
│  Consumed by:                                               │
│  src/index.ts                  (clone + generate endpoints) │
│  src/api/canvas-chat.ts        (agent uses same pipeline)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. API Changes

### 6.1 Unified import endpoint

```diff
- POST /api/canvas/clone     (current)
+ POST /api/canvas/import    (unified — replaces clone + generate)

Body:
{
  "source": {
    "type": "url" | "html" | "prompt" | "openpencil",
    "content": "https://..." | "<html>..." | "a landing page..." | LayoutDefinition
  }
}

Response:
{
  "id": "canvas-uuid",
  "title": "Imported Website"
}
```

Backward compat: `POST /api/canvas/clone` and `POST /api/canvas/generate` remain as aliases.

### 6.2 Style fidelity flag

```json
{
  "source": { "type": "url", "content": "https://factory.ai" },
  "style": "edgegde" | "preserve"
}
```

- `"edgegde"` (default): Discard source styles, apply EdgeGDE design system
- `"preserve"`: Attempt to preserve source colors/fonts (future, v1.2)

---

## 7. Testing Strategy

### 7.1 Unit tests

| Test | Input | Expected |
|------|-------|----------|
| Basic page | `<h1>Title</h1><p>Text</p>` | Page → Text("Title", level:1), Text("Text") |
| Navigation | `<nav><a href="/">Home</a><a href="/about">About</a></nav>` | Section(role:nav) → Text(href:/), Text(href:/about) |
| Hero detection | `<header><h1>Welcome</h1><p>Sub</p><a>CTA</a></header>` | Section(role:hero) → Text, Text, Button |
| Form detection | `<form><input name="email"><button>Send</button></form>` | Frame(role:form) → Input, Button |
| Script stripping | `<script>alert('xss')</script><p>Hello</p>` | Text("Hello") only |
| Empty page | `<html><body></body></html>` | Page with no children |
| Design application | Any input | All nodes have EdgeGDE default styles |

### 7.2 Integration tests

| Test | Method |
|------|--------|
| Clone factory.ai → CanvasDocument | Verify all content sections detected |
| Clone factory.ai → compileFromCanvas → HTML | Page renders without errors |
| Clone → chat edit → deploy | Full workflow |
| Prompt generate → CanvasDocument | Same pipeline as clone |
| OpenPencil migration → CanvasDocument | Same pipeline as clone |

---

## 8. Migration: Current v1 → v2

| Current file | Action |
|-------------|--------|
| `src/cloner/website-cloner.ts` | Move content to `src/transpiler/html-parser.ts`, add component mapping + design application |
| `src/cloner/` directory | Remove after migration |
| `src/generator/layout-generator.ts` | LLM now outputs raw HTML prompt → transpiler processes it identically to cloned HTML |
| `tests/cloner/` | Move to `tests/transpiler/` |
| `POST /api/canvas/clone` | Keep as alias, route through transpile() |
| `POST /api/canvas/generate` | Keep as alias, route through transpile() |

---

## 9. Comparison: Clone v1 vs Transpiler v2

| Aspect | v1 Clone | v2 Transpiler |
|--------|----------|---------------|
| **Goal** | Copy visual appearance | Import content into EdgeGDE format |
| **CSS resolution** | Required (complex) | Not needed |
| **Computed styles** | Required (browser) | Not needed — use EdgeGDE design tokens |
| **JS rendering** | Required (headless browser) | Not needed |
| **Layout inference** | Required (per-element positioning) | Simple — use EdgeGDE flex model |
| **Result** | Approximation of original | **EdgeGDE-native** (editable, consistent) |
| **Code complexity** | Very high (CSS engine + browser) | Low (content extraction + mapping) |
| **Value per effort** | Low | **High** |

The transpiler approach is ~5x less code, works without any browser dependency, and produces a better result because the output is **designed for the EdgeGDE platform** rather than being a degraded copy of the original.
