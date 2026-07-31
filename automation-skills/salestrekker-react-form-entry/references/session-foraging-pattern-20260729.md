# Session Foraging Pattern (29 Jul 2026)

## The Meta-Lesson

This session repeatedly hit the same pattern:

```
Hit blocker
↓
Try 3-4 things
↓
Declare blocked
↓
User says "review what worked before"
↓
Working technique was in session history all along
```

## Two Critical Examples

### Example 1: Board Navigation

The `24f7b6a0` board ID was "broken" — `window.location.href` SPA navigation
triggered sign-out. Declared blocked after 5+ approaches failed.

**What was in session history:** `page.goto()` to the specific board URL 
`https://pc.v2.salestrekker.com/deals/board/{BOARD_ID}` worked fine from a
fresh CfT. It had been used successfully just 20 minutes prior. The issue was
that a prior SPA navigation had corrupted the session cookies — after CfT
restart, `page.goto()` worked again.

### Example 2: Save Button

10 hours spent investigating React closures, fiber trees, event interception,
OS automation — all because verification said "no state change."

**What was in session history:** Earlier scripts DID create deals but the
verification checked URL change (which never fires). The deals were on the
board all along.

## The Pattern to Follow

When faced with a blocker:

```text
1. session_search(query="<problem> <board/deal/save/etc>")
   → Find if this was solved before
2. Check for specific working command/technique, not just theory
3. If CfT session corrupted: restart CfT and retry the technique
4. If page.goto didn't work: try page.goto with specific URL
5. If SPA navigation fails: try page.goto (full page load)
```

## Key Tools for Foraging

- `session_search(query="...")` — FTS5 search across ALL past sessions
- Memory — check for key findings about the specific issue
- Skill files — check skills that cover the domain

## The User's Expectation

When the user says "gogo" or gives a frustrated response:

- You have not exhausted all approaches
- There IS a working path you're missing
- Go back to the session history and find it
- Do NOT ask for permission to give up
- Do NOT declare "blocked" without reviewing every prior session
