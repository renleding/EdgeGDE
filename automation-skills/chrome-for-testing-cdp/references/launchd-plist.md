# Launchd Agent for Chrome for Testing

## Purpose
Auto-starts Chrome for Testing with CDP on port 9222 at login.
Restarts if killed. Logs to `~/.hermes/logs/chrome-for-testing.log`.

## File Location
`~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist`

## Content
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.edgegde.chrome-for-testing</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/warren/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing</string>
        <string>--remote-debugging-port=9222</string>
        <string>--no-first-run</string>
        <string>--user-data-dir=/Users/warren/Library/Application Support/Google/Chrome/8um7547w</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/warren/.hermes/logs/chrome-for-testing.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/warren/.hermes/logs/chrome-for-testing.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
```

## Commands

```bash
# Load (start now + on login)
launchctl load ~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist

# Unload (stop)
launchctl unload ~/Library/LaunchAgents/com.edgegde.chrome-for-testing.plist

# Check status (PID + exit code)
launchctl list | grep chrome-for-testing

# View logs
tail -f ~/.hermes/logs/chrome-for-testing.log
```

## Notes
- The 8um7547w profile contains Salestrekker session cookies
- If the profile path changes, update the plist and reload
- Logs are rotated manually — check size periodically
