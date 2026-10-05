# EG-SEC-20261004-VITEST-VULN: Security: Fix vitest/vite dependency vulnerabilities (auto-fix)

**Labels**: security, P0, auto-fix
**Status**: review
**Created**: 2026-10-04T06:00:00Z
**Source**: nightly-scan-2026-10-04

## Description

Auto-fix for nightly scan P0 finding: 4 dependency vulnerabilities in vitest/vite/esbuild/ws.

## Vulnerabilities Fixed

| Package | GHSA | Severity | Issue |
|---------|------|----------|-------|
| vitest <3.2.6 | GHSA-5xrq-8626-4rwp | critical | UI server arbitrary file read/execution |
| @vitest/mocker 2.1.0-4.1.10 | GHSA-82fw-gwwq-j7x9 | moderate | Path Traversal / Arbitrary File Read |
| vite <=6.4.2 | GHSA-fx2h-pf6j-xcff | high | `server.fs.deny` bypass on Windows |
| vite <=6.4.1 | GHSA-4w7w-66w2-5vf9 | moderate | Path Traversal in Optimized Deps `.map` |
| vite <=6.4.2 | GHSA-v6wh-96g9-6wx3 | moderate | NTLMv2 hash disclosure on Windows |

## Remaining Vulnerabilities (blocked by upstream)

| Package | GHSA | Severity | Blocked By |
|---------|------|----------|------------|
| esbuild <=0.24.2 | GHSA-67mh-4wv8-2f99 | moderate | wrangler@3.114.17 → esbuild@0.17.19 |
| ws <8.20.1 | GHSA-58qx-3vcg-4xpx | moderate | miniflare@3.20250718.3 → ws@8.18.0 |
| ws <8.21.0 | GHSA-96hv-2xvq-fx4p | high | miniflare@3.20250718.3 → ws@8.18.0 |

## Changes

- Updated `vitest` from `^2.0.0` to `^4.1.11` in `apps/afirmico-INEOS-QLD/package.json`
- Lockfile updated via `bun audit fix --latest`

## PR

- **PR #171**: https://github.com/renleding/EdgeGDE/pull/171
- **Branch**: `work/auto-fix-vuln-2026-10-04`

## Testing

- Typecheck passes (tsc --noEmit)
- Unit tests pass (1358 passed in edge-runtime)

## Acceptance Criteria

- [x] Vulnerabilities fixed in dependency (6 of 9 resolved)
- [x] PR created with fix
- [x] CI passes (typecheck, unit tests)
- [ ] PR reviewed and merged
- [ ] Verify production deployment after merge
- [ ] Monitor for upstream fixes to remaining 3 vulns