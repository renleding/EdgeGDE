# EdgeGDE PWA Canvas

`apps/pwa-canvas` is the EdgeGDE-native governed infinite-canvas PWA scaffold.

## Non-goals

- This is not the Space Agent runtime.
- It does not bridge Space Agent files, namespaces, or app-file persistence.
- Local IndexedDB drafts are cache/draft state only, never authoritative server state.
- Third-party MCP App UI remains sandboxed behind EdgeGDE policy and brokered MCP calls.

## Build / verify

```bash
bun run --cwd apps/pwa-canvas build
bun run --cwd apps/edge-runtime typecheck
```

The build copies `apps/pwa-canvas/public/*` into `apps/edge-runtime/public/pwa-canvas/` so the runtime can serve the PWA without a separate deploy pipeline.

## Routes

- `/pwa-canvas` redirects to `/pwa-canvas/index.html`
- `/pwa-canvas/index.html` is the PWA shell
- `/pwa-canvas/js/main.js` is the ES module entry point (imports all modules)
- `/pwa-canvas/pwa.css`, `/pwa-canvas/sw.js`, and `/pwa-canvas/manifest.webmanifest` are static assets
- `/pwa-canvas/js/` contains the modular canvas implementation
