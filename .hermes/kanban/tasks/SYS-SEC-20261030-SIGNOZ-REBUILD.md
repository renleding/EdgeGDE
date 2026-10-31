# SYS-SEC-20261030-SIGNOZ-REBUILD

**Priority**: HIGH
**Created**: 2026-10-30T18:00:38Z (security scan cycle)
**Source**: edgegde-security-scan.sh → SYS-SEC-0001

## Context
Security scan found 4 CRITICAL CVEs in running `signoz-otel-collector:patched-20260808`:
- GHSA-5cgq-3rg8-m6cv (golang.org/x/crypto auth bypass) CVSS 9.8
- GHSA-p77j-4mvh-x3m3 (grpc-go auth bypass) CVSS 9.8  
- CVE-2026-63073 (OpenSSL CMP format string) CVSS 9.8
- CVE-2026-34182 (OpenSSL CMS forgery) CVSS 9.1

## Upstream Status
✅ **Fixed in upstream** `signoz/signoz-otel-collector:v0.144.15` (released 2026-10-28):
- All 4 original CRITICAL CVEs resolved
- OpenSSL upgraded to 3.0.22 (fixes CVE-2026-63073, CVE-2026-34182)
- Go dependencies updated (fixes x/crypto, grpc-go)

## New Issues in v0.144.15
❌ **10 NEW CRITICAL** vulnerabilities introduced:
- libgnutls30 (CVE-2026-33845, CVE-2026-42010) - TLS library
- Go stdlib (GO-2026-4337, GO-2026-6612) - Go 1.25.0 vulnerabilities
- golang.org/x/net (GO-2026-6612) - HTTP/2 Rapid Reset
- perl-base (5 CVEs) - Perl interpreter

## Decision Required
Choose deployment strategy:

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **A: Deploy v0.144.15** | Fixes original 4 CRITICALs immediately | Introduces 10 new CRITICALs (gnutls, Go, perl) | If original CVEs are actively exploited |
| **B: Wait for v0.144.16+** | Cleaner base, all fixes | Delay unknown (days/weeks) | **Recommended** - lower risk |
| **C: Build from source** | Full control over Go deps | Complex, time-consuming, maintenance burden | Only if Option A/B unacceptable |

## Recommendation
**Option B: Wait for upstream v0.144.16+** with gnutls/Go/perl fixes.
- Original CVEs fixed in v0.144.15 but not deployed yet
- New CRITICALs in v0.144.15 are in system libraries (gnutls, perl) and Go stdlib
- Go stdlib vulns require Go 1.25.1+ rebuild
- gnutls/perl fixable via apt but need Debian security updates to propagate

## Action Items
- [ ] Monitor signoz/signoz-otel-collector releases for v0.144.16+
- [ ] If v0.144.16 not released by 2026-11-06, escalate to Option A with mitigation
- [ ] Create mitigation plan for Option A: pin gnutls/perl versions, monitor Go 1.25.1 release
- [ ] Update docker-compose / deployment manifests when ready

## Related
- Enriched CVE data: `~/.hermes/upgrade-snapshots/enriched-20261030T180038Z.json`
- Security report: `~/.hermes/upgrade-snapshots/security-report-20261030T180038Z.md`
- Previous signoz rebuild task: `SYS-SEC-20260924-DOCKER-REBUILD.md`
