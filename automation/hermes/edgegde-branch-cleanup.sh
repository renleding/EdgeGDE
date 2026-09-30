#!/usr/bin/env bash
# Wrapper for cron: runs the branch-cleanup script from the automated-code-review-pipeline skill
# with --force to actually delete (not dry-run). Full safety checks are in the script itself.
bash /Users/warren/.hermes/skills/software-development/automated-code-review-pipeline/scripts/branch-cleanup.sh --force 2>&1
