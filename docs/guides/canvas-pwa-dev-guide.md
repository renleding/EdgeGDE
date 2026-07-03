# Canvas PWA — Developer Guide

**Source:** `apps/pwa-canvas/public/`  
**Deployed:** `apps/edge-runtime/public/pwa-canvas/` (copied via `node apps/pwa-canvas/scripts/copy-static.mjs`)  
**Architecture:** Vanilla ES modules (no build step, no framework)

---

## Architecture

```
public/
├── index.html              — PWA shell
├── pwa.css                 — Stylesheet
├── manifest.webmanifest    — PWA manifest
├── sw.js                   — Service worker (offline cache)
├── icons/                  — App icons
└── js/
    ├── main.js             — Entry point (imports + init)
    ├── canvas-state.js     — Shared state, DOM refs, constants
    ├── canvas-render.js    — Render/paint objects on canvas
    ├── canvas-interactions.js — Drag, resize, snap, pan, select
    ├── canvas-selection.js — Selection logic
    ├── canvas-proposals.js — Proposal system
    ├── canvas-persistence.js — IndexedDB draft save/load
    ├── canvas-keyboard.js  — Keyboard shortcuts
    ├── canvas-properties.js — Inline property editing
    └── canvas-history.js   — Undo/redo stack
```

## Adding a New Object Type

### 1. Define the object in `canvas-state.js`

Add a new entry to `initialObjects` or create a new factory function in `canvas-interactions.js`:

```javascript
// In canvas-interactions.js
export function addNewObjectType() {
  const object = {
    id: uid('mytype'),
    type: 'my-custom-type',
    x: 200,
    y: 200,
    width: 300,
    height: 200,
    title: 'My Custom Object',
    status: 'draft',
    body: 'Description of this object.',
  }
  createProposal('add_custom_object', 'Add a custom object.', [{ kind: 'add_object', object }])
}
```

### 2. Add render logic in `canvas-render.js`

The `renderObjectElement()` function handles rendering by object type. Add a case:

```javascript
if (object.type === 'my-custom-type') {
  contentHtml = `<div class="custom-renderer">${safeText(object.body)}</div>`
}
```

### 3. Wire a button in `index.html`

```html
<button id="add-custom" type="button">+ Custom Object</button>
```

Then add the click handler in `canvas-interactions.js`:
```javascript
document.getElementById('add-custom').addEventListener('click', addNewObjectType)
```

### 4. Proposals

All object mutations go through the proposal system:
- `createProposal(kind, description, effects)` — stages the action
- Proposals require user approval before applying
- The proposal appears in the agent panel

## CSS Architecture

The Canvas PWA uses CSS custom properties for theming:

```css
:root {
  --bg: #080b14;
  --surface: rgba(255,255,255,0.08);
  --accent: #60a5fa;
  --text: #ffffff;
  --muted: rgba(255,255,255,0.72);
}
```

Add new object type styles by targeting the `type` class:
```css
.canvas-object.my-custom-type { ... }
```

## Sync & Deploy

```bash
# Copy static assets to edge-runtime
cd apps/pwa-canvas && node scripts/copy-static.mjs

# Deploy edge runtime
cd apps/edge-runtime && npx wrangler deploy --env production
```

The copy script `scripts/copy-static.mjs`:
- Deletes the target directory
- Recursively copies all files from `public/` to `apps/edge-runtime/public/pwa-canvas/`
- Skips `.DS_Store`

## Testing

The Canvas PWA has no automated tests yet. Manual testing checklist:
- [ ] Pan (drag background)
- [ ] Zoom (wheel)
- [ ] Select single object (click)
- [ ] Multi-select (shift+click)
- [ ] Rectangle select (shift+drag)
- [ ] Drag to move objects
- [ ] Resize from edges and corners
- [ ] Snap-to-object alignment
- [ ] Double-click to edit title inline
- [ ] Ctrl+Z undo / Ctrl+Y redo
- [ ] Delete key removes selection
- [ ] Escape deselects all
- [ ] Save draft / load draft (IndexedDB)
- [ ] Proposal create, approve, deny
- [ ] Offline badge
- [ ] Template buttons (Empty, Bundle, Calculator)
