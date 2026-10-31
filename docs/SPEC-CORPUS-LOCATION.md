# Where the specification documents live

As of **2026-10-31**, the FRS / IDD / SDD corpus is no longer kept in this
repository's `docs/` directory. It lives at:

```
~/hermes-master/05_DOCS/frs/
```

That directory holds the canonical copies, plus a generated `INDEX.md` listing
every document with its title and size, and a `README.md` describing the
conventions.

## Why

`docs/` had accumulated 56 specification documents (≈1.1 MB) alongside runbooks,
research notes, and engineering guides. They are long-lived reference material
that changes on a different cadence from the code, and they belong with the rest
of the Hermes master documentation tree.

## History is still here

This directory is intentionally unversioned, so the moved documents have no
change history of their own. **Git history for them remains in this repository** —
use it to see how a document evolved before the move:

```sh
git log --follow -- docs/FRS-002-agentic-coding-capability.md
```

## Four documents deliberately remain in `docs/`

They are read directly by CI, which cannot see `~/hermes-master`:

| Document | Consumer |
|---|---|
| `FRS-010-afirmico-auto-tesla-fleet-data-v1.md` | `apps/afirmico-tesla/test/signer-host.test.ts` |
| `SDD-010-afirmico-auto-telemetry-architecture-v1.md` | `apps/afirmico-tesla/test/*.test.ts` |
| `SDD-011-afirmico-auto-config-scopes-v1.md` | `.ste-lint-baseline.json` |
| `IDD-016-orca-resolver-bridge-v1.md` | contract pointer in `packages/orca-resolver-bridge/mcp-tool.json` |

Do not move these four until the guards that read them have been redesigned.
They parse specification prose, so keeping a copy in the repo would not satisfy
them — the assertions must be reworked first.

## Known issue carried over

Seven document numbers are duplicated (FRS-008, 009, 010, 011, 012, plus
`FRS-canvas` and `FRS-chat`). Renumbering is a separate task and was
deliberately not folded into the move.
