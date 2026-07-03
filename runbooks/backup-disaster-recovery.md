# Backup & Disaster Recovery — EdgeGDE + Cubbit

**Next scheduled backup:** Sunday 3am AEST (cron: `cubbit-weekly-backup`)  
**Script:** `~/.hermes/scripts/cubbit-backup.sh`  
**Destination:** Cubbit DS3 (S3-compatible object storage)  
**Credentials:** Stored in `~/.hermes/.env`

---

## What Gets Backed Up

| Asset | Size | Frequency | Retention |
|-------|------|-----------|-----------|
| EdgeGDE source repo (latest) | ~7 MB | Weekly | Latest + 1 dated |
| EdgeGDE source repo (dated) | ~7 MB | Weekly | 1 copy |
| Hermes session DB + config (latest) | ~240 MB | Weekly | Latest + 1 dated |
| Hermes session DB + config (dated) | ~240 MB | Weekly | 1 copy |

## Backup Locations

### Cubbit (Primary)
```
cubbit://cubbit-bucket1/Backups/EdgeGDE/
├── edgegde-latest.tar.gz
├── edgegde-YYYY-MM-DD.tar.gz
├── hermes-latest.tar.gz
└── hermes-YYYY-MM-DD.tar.gz
```

### Local (Secondary — ad-hoc)
- EdgeGDE: `~/Documents/_HQ_AI/EdgeGDE/` (git — push to GitHub for remote)
- Hermes: `~/.hermes/` (config, session DB, scripts, skills)

## Restore Procedures

### Restore EdgeGDE from Cubbit

```bash
# 1. Download the archive
cubbit download cubbit://cubbit-bucket1/Backups/EdgeGDE/edgegde-2026-07-05.tar.gz /tmp/

# 2. Extract
tar xzf /tmp/edgegde-2026-07-05.tar.gz -C ~/Documents/_HQ_AI/

# 3. Verify git integrity
cd ~/Documents/_HQ_AI/EdgeGDE && git fsck --full
```

### Restore Hermes from Cubbit

```bash
# 1. Download
cubbit download cubbit://cubbit-bucket1/Backups/EdgeGDE/hermes-2026-07-05.tar.gz /tmp/

# 2. Stop Hermes (if running)
# 3. Backup current state
mv ~/.hermes ~/.hermes.bak

# 4. Extract
tar xzf /tmp/hermes-2026-07-05.tar.gz -C ~/

# 5. Restart Hermes
# 6. Verify: check session DB and cron jobs
```

### Restore from Git (EdgeGDE only)

```bash
cd ~/Documents/_HQ_AI/EdgeGDE
git fetch origin
git reset --hard origin/main
```

## Troubleshooting

### Backup Script Fails

```bash
# Run manually with verbose output
bash -x ~/.hermes/scripts/cubbit-backup.sh 2>&1 | tee /tmp/backup-debug.log

# Common issues:
# - ~/.hermes/.env not sourced → check ENV_FILE path in script
# - Cubbit DS3 credentials expired → check `cubbit login`
# - Disk space → check `df -h /`
```

### Cubbit DS3 Unavailable

Check connectivity:
```bash
# Test Cubbit connectivity
cubbit ls cubbit://cubbit-bucket1/ 2>&1

# Re-authenticate if needed
cubbit login
```

If Cubbit is down for >24h, create a manual tarball:
```bash
tar czf /tmp/edgegde-emergency-$(date -I).tar.gz \
  -C ~/Documents/_HQ_AI EdgeGDE
tar czf /tmp/hermes-emergency-$(date -I).tar.gz \
  -C ~/ --exclude=.hermes/cron --exclude=.hermes/cache .hermes
```

## Monitoring

- Backup cron: Runs weekly, silent on success, alerts on failure
- Health check: `curl -s https://edgegde-calculator.renleding.workers.dev/healthz`
- Cubbit status: `cubbit status`
