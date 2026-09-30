# Hermes Automation Scripts (EdgeGDE)

Version-controlled copies of the Hermes-side automation that operates this
repository. These scripts live and execute from `~/.hermes/scripts/`; this
directory exists so they get **code review, history, and diff visibility** like
any other part of the system.

## Why this directory exists

`~/.hermes/scripts/` is not a git repository. The automation in it merges every
PR in this repo — so it was the one component merging everything else while
receiving no review itself. That gap caused a real defect: `edgegde-sdlc.sh`
used `gh pr merge --delete-branch`, whose side effect is to delete the *local*
branch and move the shared working tree to `main`. An interactive session
parked on that branch was silently yanked onto `main`, and its next commit
landed there directly — bypassing PR and CI. It recurred three times before it
was traced.

## Source of truth and sync model

**`~/.hermes/scripts/` is the source of truth.** These copies are a mirror for
review and history. Nothing here is executed by cron.

That means edits can drift in either direction, so treat the mirror as
**review-visible, or not**:

- **Change a script in `~/.hermes/scripts/` and re-run `sync-to-repo.sh`.**
  Never hand-edit the copy here and expect the runtime to pick it up.
- `sync-to-repo.sh` refuses to stage a file containing a detected secret, so a
  credential cannot reach this public repository by accident.

A mirror that silently goes stale is worse than no mirror, because it implies
review that never happened. If you change a script and do not sync it, the next
person reading this directory is reading history, not the running system.

## Inventory

Schedule column reflects the live cron job (`~/.hermes/cron/jobs.json`).

### SDLC outer loop

| Script | Schedule | Cron job | Purpose |
|---|---|---|---|
| `edgegde-sdlc.sh` | invoked | — | push → PR → CI poll → merge → deploy |
| `edgegde-ci-poll.sh` | `0 * * * *` | `9f8f66a5a967` | cron wrapper: polls open PRs, merges green ones when `gogo` |
| `edgegde-cleanup-worktrees.sh` | `0 3 * * *` | `9767b8866be2` | prune stale git worktrees |
| `edgegde-branch-cleanup.sh` | `0 5 * * 0` | `0285eac9801d` | delete merged remote branches |
| `edgegde-self-heal.sh` | `0 */4 * * *` | `33033caf9d07` | strip orphan keys from the auth file |
| `edgegde-deploy-auto-fix.py` | `every 15m` | `7a236c7c7e80` | detect and repair deploy failures |
| `edgegde-security-scan.sh` | `0 5 * * *` | `44c8d0fcb3dd` | dependency / vulnerability scan |
| `edgegde-upgrade-discover.sh` | `every 2880m` | `761730b37a61` | autonomous upgrade discovery |

### Scheduled EdgeGDE operations

| Script | Schedule | Cron job | Purpose |
|---|---|---|---|
| `droid-daily-infra.sh` | `0 8,15 * * *` | `0e0077bf4088` | daily infrastructure health check |
| `afirmico-kb-health.sh` | `every 10m` | `92319ad156c2` | AFIRMICO knowledge base liveness |
| `chat-health-check.sh` | `0 */4 * * *` | `d637e15a7698` | chat endpoint health |
| `continuous-improvement-loop.sh` | `0 10,12,22,4 * * *` | `c4b2a8cff3bb` | continuous improvement sweep |
| `process-agent-ready-queue.sh` | `*/30 * * * *` | `d57cb59dc964` | drain the agent-ready queue |
| `d1-backup.sh` | `0 2 * * *` | `d1-backup-auto` | D1 database backup |
| `cubbit-backup.sh` | `0 3 * * *` | `1dd69fc40ed2` | S3-compatible backup to Cubbit DS3 |

### Manual / on-demand

| Script | Purpose |
|---|---|
| `kv-quota-audit.sh` | audit KV read/write quota |
| `mempalace-kg-rebuild.py` | rebuild the MemPalace knowledge graph |
| `restructure_mempalace.py` | reorganise MemPalace layout |

## Exclusions

Deliberately **not** mirrored:

| File | Reason |
|---|---|
| `st_downloader.py` | Salestrekker tooling; contains a hardcoded live TOTP seed |
| `st_as_downloader.py` | same |
| `cubbit-backup.sh.bak.2026-09-04` | stale backup copy |

Personal, non-EdgeGDE tooling (memPalace servers, Mac desktop helpers, local
model routing) also stays out of this directory.

**Note on the TOTP seed:** a live TOTP secret was found hardcoded in the two
Salestrekker scripts above, in a directory that is not under version control.
It has not been committed anywhere. It should be moved to an environment
variable or the secret store, and the underlying TOTP enrolment rotated, since
a hardcoded seed in a plaintext file is compromised by definition.

## Handling secrets

Scripts here must read credentials from the environment or the secret store,
never embed them:

```bash
: "${CUBBIT_DS3_ACCESS_KEY_ID:?FATAL: not set (check ~/.hermes/.env)}"
```

Identifiers already published elsewhere in this public repo (Cloudflare account
id, worker names) are not treated as secrets. Actual credentials are — and
`sync-to-repo.sh` blocks them.

## Known hazards

**Shared working tree.** The poller runs in the main checkout that an
interactive session may be using. `cmd_ci_poll` records `orig_branch` and
restores it, and it retires only *remote* refs after a merge
(`git push origin --delete`) — never `gh pr merge --delete-branch`, which would
delete the local branch and move the tree. Repository-level
`deleteBranchOnMerge` must stay `false` for the same reason.

**Before committing in this repo, run `git branch --show-current`.**

**Authorization file.** `~/.hermes/.edgegde-auth.json` holds two gates:

```json
{"gogo": true, "deploy_block": false}
```

`gogo` authorizes push and PR. Merge and deploy require `gogo` **and**
`deploy_block=false`. Stale keys are stripped automatically by
`edgegde-self-heal.sh`.
