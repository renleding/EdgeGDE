# EG-SEC-20260929-UNDICI-VULN: Security: Fix undici DoS vulnerability (GHSA-3wwx-pv8p-q78v)

**Labels**: security, P0, auto-fix
**Status**: review
**Created**: 2026-09-29T20:00:00Z
**Source**: nightly-scan-2026-09-29

## Description

Auto-fix for nightly scan P0 finding: dependency vulnerability in undici@7.29.0.

## Vulnerability

| Field | Value |
|-------|-------|
| **Package** | undici@7.29.0 |
| **CVE/GHSA** | GHSA-3wwx-pv8p-q78v |
| **Severity** | moderate (DoS) |
| **Issue** | Denial of Service via unhandled error in WebSocket permessage-deflate decompression |
| **Fixed in** | undici@7.29.1 |

## Changes

- Updated `bun.lock` to use undici@7.29.1

## PR

- **PR #123**: https://github.com/renleding/EdgeGDE/pull/123
- **Branch**: `work/auto-fix-vuln-2026-09-29`

## Testing

- `bun audit` passes with 0 vulnerabilities
- Typecheck passes
- Unit tests pass (1358 passed)

## Acceptance Criteria

- [x] Vulnerability fixed in dependency lockfile
- [x] PR created with fix
- [x] CI passes (typecheck, unit tests)
- [x] `bun audit` passes with 0 vulnerabilities
- [x] Unit tests pass (1358/1358)
- [ ] PR reviewed and merged
- [ ] Verify production deployment after merge