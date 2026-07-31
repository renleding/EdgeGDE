# Gateway Launchd Setup + FD Limit

## Why This Matters

The Hermes gateway manages 27+ cron jobs, MCP servers, and Telegram polling. The default macOS file descriptor limit (`maxfiles=256`) is too low — the gateway exhausts FDs and can't make outbound connections. Symptoms:
- `[Errno 24] Too many open files` in gateway logs
- Telegram bot token "already in use" on restart
- Webhook reconnect loop on port 8644

## Permanent Fix: Launchd Agent + FD Limit Wrapper

### FD Limit Wrapper
`~/.hermes/scripts/hermes-gateway-wrapper.sh`:
```bash
#!/bin/bash
ulimit -n 1024
exec /Library/Frameworks/Python.framework/Versions/3.11/bin/hermes gateway run
```
The `ulimit -n 1024` must be set BEFORE the `exec`.

### Launchd Agent
`~/Library/LaunchAgents/com.edgegde.gateway.plist`:
- `RunAtLoad=true`, `KeepAlive=true` — auto-starts, restarts if killed
- Logs to `~/.hermes/logs/gateway-launchd.log`
- PATH includes `/Users/warren/.local/bin` for `hermes` binary

**DO NOT use `--replace`** in the wrapper — launchd lifecycle conflicts with the replace signal.

### Commands
```bash
launchctl load ~/Library/LaunchAgents/com.edgegde.gateway.plist
launchctl unload ~/Library/LaunchAgents/com.edgegde.gateway.plist
launchctl list | grep edgegde.gateway
```

## Webhook Port Conflict
`[webhook] Could not bind :8644: address already in use` — webhook module conflicts with itself. Fix: disable webhook in config.yaml (`platforms.webhook.enabled: false`) or leave it (cosmetic).

## Telegram Token Conflict
`Telegram bot token already in use (PID X)` — wait ~30s for Telegram timeout, or kill old gateway.

## Verification
```bash
lsof -i :8642 -P | grep LISTEN
curl -s localhost:8642/health
launchctl list | grep edgegde.gateway
```
