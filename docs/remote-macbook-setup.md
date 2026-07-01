# EdgeGDE — Remote MacBook Setup
## Native install (no Podman), Ollama on host

### Prerequisites
- macOS (Apple Silicon)
- Ollama installed: `curl -fsSL https://ollama.com/install.sh | sh`
- Hermes pack: `~/hermes-remote-pack/` (2.9MB, prepared from primary machine)

### Step 1: Copy Hermes config
```bash
# From primary machine:
scp -r ~/hermes-remote-pack user@remote-mac:~/.hermes
```

### Step 2: Install Hermes
```bash
pip install hermes-agent
```

### Step 3: Pull models
```bash
ollama pull ornith:9b
ollama pull qwen3-vl:4b   # for vision/computer-use
```

### Step 4: Verify config
```bash
cat ~/.hermes/config/config.yaml
# Expected: provider=ollama, model=ornith:9b
```

### Step 5: Start gateway
```bash
hermes gateway start
# launchd plist is auto-installed with KeepAlive=true
# Gateway port: 8642
```

### Step 6: Verify
```bash
# Cron jobs register automatically from config
hermes cron list

# Kanban boards available
hermes kanban boards
```

### What is NOT synced (intentionally)
- `memories/` — personal memory stays on primary
- `mempalace-ladybug-projection/` — reseed on remote if needed
- `logs/`, `cache/`, `sessions/` — ephemeral runtime state
- `kanban/` — starts fresh on remote (per your instruction)
