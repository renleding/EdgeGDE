#!/bin/bash
# Wrapper script called by Hermes cron for automated worktree cleanup
# Uses bash explicitly (not exec) due to macOS provenance xattr on the target script
bash /Users/warren/Documents/_HQ_AI/EdgeGDE/scripts/cleanup-worktrees.sh --prune --max-age 14
