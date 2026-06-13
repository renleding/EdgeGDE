#!/bin/bash
# Serve the system dashboard on port 8899
# Managed by launchd: com.hermes.system-dashboard-server
cd /Users/warren/Documents/_HQ_AI
exec python3 -m http.server 8899 --bind 0.0.0.0
