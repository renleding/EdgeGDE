# SYS-SEC-20260924-DOCKER-REBUILD: Security: Rebuild Docker images with patched base images

**Labels**: security, critical
**Status**: backlog
**Created**: 2026-09-25T00:00:00Z
**Source**: edgegde-security-scan.sh (SYS-SEC-0001)

## Description

Critical vulnerabilities found in Docker base images (litellm-proxy, signoz-otel-collector, signoz-query-service, signoz-zookeeper, signoz-alertmanager). All have upstream fixes available. Need to rebuild with updated base tags.

## Critical Vulnerabilities (6)

| CVE/GHSA | Package | CVSS | Fixed In | Affected Image |
|----------|---------|------|----------|----------------|
| CVE-2026-63073 | libcrypto3/libssl3 (OpenSSL 3.3.7-r0) | 9.8 | 3.3.7-r1 | signoz-otel-collector |
| GHSA-5cgq-3rg8-m6cv | golang.org/x/crypto (v0.31.0) | 9.1 | 0.52.0 | signoz-otel-collector |
| GHSA-82r6-8w77-94w6 | anyio (4.13.0) | CRITICAL | 4.14.2 | litellm-proxy |
| GHSA-c4c3-7fpv-j4q5 | netty-handler (4.1.113.Final) | CRITICAL | 4.1.137.Final | signoz-zookeeper |
| GHSA-p77j-4mvh-x3m3 | google.golang.org/grpc (v1.67.1) | 9.1 | 1.79.3 | signoz-otel-collector, signoz-query-service |
| GHSA-xgrm-4fwx-7qm8 | github.com/jackc/pgx/v5 (v5.7.2) | 9.8 | 5.9.0 | signoz-query-service |

## High Vulnerabilities (6)

| CVE/GHSA | Package | CVSS | Fixed In | Affected Image |
|----------|---------|------|----------|----------------|
| CVE-2026-85091 | zlib (1.3.2-r5) | 7.4 | 1.3.2.1_rc20260601-r0 | litellm-proxy |
| GHSA-355h-qmc2-wpwf | jetty-http (9.4.56.v20240826) | 7.4 | 9.4.60 | signoz-zookeeper |
| GHSA-4g8c-wm8x-jfhw | netty-handler (4.1.113.Final) | 7.5 | 4.1.118.Final | signoz-zookeeper |
| GHSA-crhr-qqj8-rpxc | zookeeper (3.9.3) | HIGH | 3.9.5 | signoz-zookeeper |
| GHSA-hp3v-5vw7-fx9w | RestrictedPython (8.3) | 8.4 | 8.4 | litellm-proxy |
| BIT-zookeeper-2026-24308 | zookeeper (3.9.3-1) | UNKNOWN | 3.9.5 | signoz-zookeeper |

## Go Stdlib Vulnerabilities (4 - require base image Go upgrade)

| GO ID | Package | Fixed In | Affected Images |
|-------|---------|----------|-----------------|
| GO-2025-3563 | stdlib (go1.21.13, go1.22.7, go1.23.6) | 1.23.8, 1.24.2+ | signoz-alertmanager, signoz-otel-collector, signoz-query-service |
| GO-2026-4337 | stdlib (go1.21.13, go1.22.7, go1.23.6) | 1.24.13, 1.25.7+ | signoz-alertmanager, signoz-otel-collector, signoz-query-service |
| GO-2026-4341 | stdlib (go1.21.13, go1.22.7, go1.23.6) | 1.24.12, 1.25.6+ | signoz-alertmanager, signoz-otel-collector, signoz-query-service |
| GO-2026-4981 | stdlib (go1.22.7, go1.23.6) | 1.25.10, 1.26.3+ | signoz-otel-collector, signoz-query-service |

## Required Docker Image Rebuilds

1. **litellm-proxy**: Rebuild with anyio>=4.14.2, restrictedpython>=8.4, zlib>=1.3.2.1
2. **signoz-zookeeper**: Rebuild with netty-handler>=4.1.137.Final, zookeeper>=3.9.5, jetty-http>=9.4.60
3. **signoz-alertmanager**: Rebuild with Go>=1.24.12 (base image upgrade required)
4. **signoz-otel-collector**: Rebuild with Go>=1.24.13, golang.org/x/crypto>=0.52.0, grpc-go>=1.79.3, OpenSSL>=3.3.7-r1
5. **signoz-query-service**: Rebuild with Go>=1.24.13, grpc-go>=1.79.3, pgx>=5.9.0

## Details

Full enrichment data: `~/.hermes/upgrade-snapshots/enriched-20260924T192048Z.json`
Full classification: `~/.hermes/upgrade-snapshots/classification-20260924T192048Z.json`
Full report: `~/.hermes/upgrade-snapshots/security-report-20260924T192048Z.json`

## Acceptance Criteria

- [ ] All 5 Docker images rebuilt with patched base images
- [ ] Re-run `bash ~/.hermes/scripts/edgegde-security-scan.sh` - zero critical/high findings
- [ ] Verify affected services still function correctly after rebuild