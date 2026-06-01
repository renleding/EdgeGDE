# EdgeGDE — Secret Inventory

| Secret Name | Scope | Set Via | Rotation |
|-------------|-------|---------|----------|
| `ADMIN_API_TOKEN` | Full control plane — admin routes, scoring dashboard, vault | `wrangler secret put ADMIN_API_TOKEN` | As needed |
| `LLM_API_KEY` | Queue consumer — OpenRouter for LLM signal scoring | `wrangler secret put LLM_API_KEY` | Per provider policy |
| `ALERT_WEBHOOK_URL` | Cron dispatcher — hot lead webhook destination | `wrangler secret put ALERT_WEBHOOK_URL` | Per endpoint change |
| `SWARM_AUTH_TOKEN` | Swarm ingress — external agent event ingestion only | `wrangler secret put SWARM_AUTH_TOKEN` | Per compromise |

## Setting a secret

```bash
echo "<value>" | npx wrangler secret put <SECRET_NAME>
```

## Listing current secrets

```bash
npx wrangler secret list
```

## Removing a secret

```bash
npx wrangler secret delete <SECRET_NAME>
```

## Notes

- Secrets are environment-scoped. The production worker reads production secrets.
- No local `.env` file exists — all secrets are Cloudflare-managed.
- `SWARM_AUTH_TOKEN` must NOT equal `ADMIN_API_TOKEN` (enforced at runtime).
