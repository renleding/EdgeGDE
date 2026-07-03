# Performance Audit — EdgeGDE PWA Assets

**Date:** 2026-07-03  
**Method:** curl timing + size measurement (production worker)  
**Worker:** edgegde-calculator (version 7a63ffe1)

---

## AI Tutor PWA (`/ai-tutor/math/`)

| Metric | Value |
|--------|-------|
| TTFB | **37ms** |
| HTML size | 3,721 bytes |
| JS bundle (pwa.js) | 17,899 bytes |
| CSS (pwa.css) | 6,348 bytes |
| CDN (KaTeX CSS) | 23,335 bytes (browser-cached) |
| CDN (KaTeX JS + Mermaid + pdf.js) | ~200KB (browser-cached) |
| **Total critical path** | **~28KB** (HTML+JS+CSS) |
| **Total with CDN** | ~250KB (CDN deps are cacheable) |

**Status: ✅ Good.** Sub-40ms TTFB. Small JS bundle. CDN deps are standard and cacheable.

## Canvas PWA (`/pwa-canvas/`)

| Metric | Value |
|--------|-------|
| TTFB | **52ms** |
| HTML size | 3,508 bytes |
| JS (10 ES modules) | 45,973 bytes |
| CSS (pwa.css) | 8,898 bytes |
| **Total critical path** | **~58KB** |
| HTTP requests (JS) | **10** (one per module) |

**Status: ✅ Good TTFB, ⚠️ 10 HTTP requests for JS.**  
The modular architecture costs 10 round-trips instead of 1 for the monolithic `pwa.js`. For production, consider bundling the modules into a single file. The total JS is nearly identical to the old monolithic version (47,856 bytes), so no size regression — only the request count changed.

## Recommendations

| Priority | Action | Impact |
|----------|--------|--------|
| **P3** | Bundle Canvas PWA modules into 1 file for prod | Reduces 10 HTTP requests → 1. ~100ms improvement on cold load |
| **P4** | Preload KaTeX CSS in AI Tutor `<head>` | Eliminates render-blocking CSS fetch |
| **P4** | Add `modulepreload` hints for Canvas PWA modules | Helps browser parallelize module fetching |
