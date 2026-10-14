#!/usr/bin/env python3
"""Writing adjuster for Saga tests (gap #3).

Applies the task's declared content to the file. Receives
JSON {content, failure, iteration} on stdin (current file
content) and prints the NEW content to stdout — which is
the task's args.content, injected via the ADJUSTER_CONTENT
env var by the test.

This lets droid/execute.py's CodeValidateLoop actually
mutate the file (without an external agent), so a failing
verification triggers real Saga compensation.
"""

import json
import os
import sys

payload = json.load(sys.stdin)
# The test injects the desired content via env var
new_content = os.environ.get("ADJUSTER_CONTENT", "")
if not new_content:
    # Fallback: echo back current content (no-op)
    new_content = payload.get("content", "")
print(new_content, end="")
