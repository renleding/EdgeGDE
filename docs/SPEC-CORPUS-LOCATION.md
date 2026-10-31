# Where the specification documents live

As of **2026-10-31**, the complete FRS / IDD / SDD corpus has left this
repository. It lives at:

```
~/hermes-master/05_DOCS/frs/
```

That directory is a **git repository with its own CI**. It holds all 56
specification documents, a generated `INDEX.md`, an `ALIASES.md` recording every
renumbering, and `check_specs.py` — the specification checks that used to live in
`apps/afirmico-tesla/test/`.

## Why

`docs/` had accumulated 56 specification documents (≈1.1 MB) alongside runbooks,
research notes, and engineering guides. Specifications change on a different
cadence from code, and they belong with the rest of the Hermes master
documentation.

## History is still here

Git history for the moved documents remains in this repository:

```sh
git log --follow -- docs/FRS-002-agentic-coding-capability.md
```

## Checks that moved with the documents

Two guards in `apps/afirmico-tesla/test/` asserted what the *specifications say*:
that SDD-010 draws the signer as its own tier and keeps it off the public port
story, that §9 O-4 stays open, that FRS-010 F02-R11 names a role and not a host,
and that the §4.1 config carries the authoritative field set.

Those assertions only work if the specifications sit next to them — exactly the
coupling this relocation removes. They now run in the corpus CI
(`frs/check_specs.py`, 17 checks). The halves that belong here stayed:
`signer-host.test.ts` still scans this codebase for retired co-location claims,
and `general-authorisation-copy.test.ts` still scans its operative copy.

## Numbering

Five numbers (008, 009, 010, 011, 012) were each used by two documents. Nine
documents across those series were renumbered, keeping the anchored twin and
moving whole FRS/IDD/SDD series together. `ALIASES.md` in the corpus maps every
old number to its replacement. One collision remains, `IDD-011`, deliberately
left because its other document is cited three times inside
`apps/afirmico-tesla`.

## Adding or changing a specification

Edit it in the corpus repository and let its CI run. Do not reintroduce
specifications into `docs/` — this directory is for engineering documentation,
runbooks, and research notes.
