#!/usr/bin/env python3
"""Count D1 database tables across all wrangler environments."""
import json

with open("wrangler.json") as f:
    cfg = json.load(f)

envs = {"preview": cfg.get("d1_databases", [])}
envs.update({k: v.get("d1_databases", []) for k, v in cfg.get("env", {}).items()})

total = 0
for name, dbs in sorted(envs.items()):
    count = len(dbs)
    print(f"{name}: {count}")
    total += count
print(f"total: {total}")
