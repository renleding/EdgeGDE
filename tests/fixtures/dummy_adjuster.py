#!/usr/bin/env python3
"""Dummy adjuster for testing droid/execute.py --adjust-cmd.

Reads JSON {"content", "failure", "iteration"} on stdin,
replaces the marker BROKEN with FIXED, prints adjusted content.
"""

import json
import sys

payload = json.load(sys.stdin)
content = payload.get("content", "")
adjusted = content.replace("BROKEN", "FIXED")
print(adjusted, end="")
