# Functional Requirement Spec: Canvas Editor PWA v2

**Status:** Draft · **Version:** 0.1.0 · **Target:** apps/pwa-canvas v2.0.0
**Depends on:** PR #21 (merged), PR #22 (merged)

---

## 1. Objective

Upgrade the existing EdgeGDE PWA Canvas from a read-only/preview scaffold to a **functional visual editor** where users can:

- Create and arrange canvas objects (notes, iframe sandboxes, agent panels)
- Edit object properties via an inspector panel
- Save drafts locally and publish workspaces to the EdgeGDE runtime
- Undo/redo local mutations
- See real-time preview of changes

The canvas remains **non-authoritative** — server state is always source of truth. The PWA is a local editing surface.

---

## 2. Current Baseline

### 2.1 Existing Capabilities (`apps/pwa-canvas/public/js/`, 10 modules)

|| Feature | Implementation | Status |
||---------|---------------|--------|
|| Infinite canvas with pan/zoom | Pointer events + CSS transform | ✅ Working |
| Drag to move objects | Pointer capture + delta tracking | ✅ Working |
| 8-direction resize | Handle detection + edge constraints | ✅ Working |
| Object selection (single + multi) | Shift+click, click-through | ✅ Working |
| Snap-to-object alignment | X/Y guide scoring | ✅ Working |
| Rectangle select (shift-drag) | Drag selector with add/remove | ✅ Working |
| Proposal system | approve/deny UI with version checks | ✅ Working |
| IndexedDB draft save | `saveDraft()` / `loadDraft()` | ✅ Working |
| Online/offline detection | `navigator.onLine` + badge | ✅ Working |
| Mortgage calculator iframe | Sandboxed srcdoc | ✅ Working |
| Inspector panel | Selection summary (read-only text) | ✅ Basic |
| Agent instruction form | Textarea → creates proposal | ✅ Basic |
| Template buttons | Empty / Bundle / Calculator | ✅ Basic |

### 2.2 Architecture

```\npublic/
  js/main.js        — entry point (imports all modules)
  js/               — modular canvas implementation (10 modules)
  pwa.css           — Stylesheet
  index.html        — PWA shell with topbar, agent panel, canvas, inspector
  sw.js             — Service worker (offline cache)
  manifest.webmanifest  — PWA manifest
```

There is **no build step**. JS/CSS are copied as static assets to `apps/edge-runtime/public/pwa-canvas/` via `scripts/copy-static.mjs`.

### 2.3 Gaps (v2 targets)

| Gap | Impact |
|-----|--------|
| No property editor (double-click = nothing) | Users can't change object content |
| No undo/redo | Every mutation is destructive |
| No publish flow | Drafts stay in IndexedDB forever |
| No keyboard shortcuts | Delete, Escape, Ctrl+Z don't work |
| 971-line monolithic JS file | Impossible to maintain or test |
| No real-time preview | Must save and reload to see changes |
| No multi-user awareness | No conflict detection |

---

## 3. Requirements

### 3.1 P0 — Must Have (core editing)

**R1 – Property Editor**
- Double-click an object → opens an inline editor or inspector panel form
- Editable fields: title, body/content, width, height, x, y
- For iframe objects: editable srcdoc URL or raw HTML
- Changes apply immediately to the local canvas (mutation, not proposal)
- Save button persists to IndexedDB

**R2 – Undo / Redo**
- Track every local mutation (add, delete, move, resize, edit property)
- Ctrl+Z / Ctrl+Shift+Z or toolbar buttons
- Undo stack depth: at least 50
- Undo across save boundaries (saving doesn't clear the stack)

**R3 – Object CRUD**
- Add: from toolbar buttons (+ Note, + App) and via proposals
- Delete: select + Delete key or right-click → delete
- Keyboard shortcut: Delete/Backspace removes selected objects
- Escape deselects all

**R4 – Publish to EdgeGDE**
- "Publish" button sends canvas state to `POST /api/v1/canvas/publish`
- Payload: `{ objects: CanvasObject[], version: number, sessionId }`
- Server validates, returns a mission ID
- Progress indicator during publish
- On success: updates timestamp, shows confirmation
- On failure: shows error, keeps local draft intact

### 3.2 P1 — Should Have (quality of life)

**R5 – Keyboard shortcuts**
| Key | Action |
|-----|--------|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Delete/Backspace | Delete selected |
| Escape | Deselect all |
| Ctrl+A | Select all |
| Ctrl+S | Save draft |
| Ctrl+Enter | Publish |

**R6 – Right-click context menu**
- On object: Edit, Duplicate, Delete, Bring to front, Send to back
- On canvas background: Paste, Select all, Reset view

**R7 – Zoom controls**
- Current: wheel zoom (working)
- Add: zoom slider or +/- buttons in toolbar
- Add: "Fit to screen" button that zooms to show all objects
- Display zoom percentage

**R8 – Grid & alignment**
- Current: snap-to-object (working)
- Add: snap-to-grid (configurable grid size: 10/20/40px)
- Add: alignment toolbar buttons (align left, center, right, top, middle, bottom)
- Add: distribute evenly (horizontal/vertical)

### 3.3 P2 — Nice to Have

**R9 – Multi-user awareness**
- Before publish, fetch server version from `GET /api/v1/canvas/version`
- Warn if server version > local version (conflict)
- Show who last edited (if available)

**R10 – Template system**
- Save current canvas as a named template
- Load template from a gallery
- Pre-installed templates: Blank, Mortgage Calculator Bundle, Onboarding

**R11 – Performance**
- Virtual rendering for >50 objects (only render visible objects)
- Lazy-load iframes (only render when scrolled into view)
- Debounce IndexedDB saves (500ms after last mutation)

---

## 4. Architecture

### 4.1 Module Structure (v2)

Replace the monolithic `pwa.js` with a module system:

```
public/
  pwa.js            → entry point (bootstraps modules)
  modules/
    canvas.js        — Pan/zoom, transform, grid
    objects.js       — CRUD, selection, resize, move, snap
    history.js       — Undo/redo stack
    properties.js    — Property editor panel
    proposals.js     — Proposal system (refactored from v1)
    persistence.js   — IndexedDB + publish API
    keyboard.js      — Shortcuts
    menubar.js       — Right-click menu
  pwa.css           → enhanced styles
  index.html        → updated shell
```

### 4.2 Type Definitions

```typescript
interface CanvasObject {
  id: string
  type: 'note' | 'agent-panel' | 'mcp-app' | 'onboarding' | 'bundle-review'
  x: number
  y: number
  width: number
  height: number
  title: string
  body: string
  variant?: string       // e.g. 'edge-calculator'
  status?: string
}

interface CanvasSnapshot {
  version: number
  objects: CanvasObject[]
  timestamp: string
}

interface PublishPayload {
  objects: CanvasObject[]
  version: number
  sessionId: string
  correlationId: string
}
```

### 4.3 API Contract

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/canvas/publish` | POST | Save workspace state |
| `/api/v1/canvas/version` | GET | Get latest version (conflict check) |
| `/api/v1/canvas/workspace/:id` | GET | Load a published workspace |

### 4.4 No-Build Constraint

v2 must remain a **no-build-step** PWA (no npm dependencies, no bundler). This means:

- ES modules via `type="module"` in the HTML script tag
- Import maps instead of module resolution
- Vanilla JS classes, no framework
- DOM manipulation, not virtual DOM

If this constraint proves too limiting for editor complexity, the FRS should be revised to allow a Vite + TypeScript build step.

---

## 5. Implementation Phases

| Phase | Items | Effort |
|-------|-------|--------|
| **1** | Module refactor (`pwa.js` → modules/), property editor, undo/redo | 3d |
| **2** | Publish flow, keyboard shortcuts, delete | 1d |
| **3** | Context menu, zoom controls, grid/alight | 1d |
| **4** | Multi-user, templates, performance | 1d |
| **Total** | | **~6d** |

---

## 6. Non-Goals (explicitly out of scope)

- Real-time multiplayer / WebSocket sync
- Mobile-native experience (tablet OK, phone not)
- Canvas effects (particle systems, animations)
- Image upload / rich media embeds
- Integration with third-party design tools
