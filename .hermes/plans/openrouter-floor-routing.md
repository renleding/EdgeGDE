# Implementation Plan: OpenRouter Dynamic Cheapest Provider Routing

## Objective
Update `t2c-orchestrator-blend` model in LiteLLM config to use OpenRouter's `:floor` suffix (price-based sorting) so new cheaper providers are automatically preferred at request time.

## Current State
- `t2c-orchestrator-blend` uses `openrouter/deepseek/deepseek-v4-flash` without provider routing
- OpenRouter load-balances by default (not strictly cheapest-first)
- New cheaper providers on OpenRouter won't be auto-prioritized

## Target State
- `t2c-orchestrator-blend` uses `openrouter/deepseek/deepseek-v4-flash-0731:floor`
- OpenRouter sorts providers by price at request time (cheapest → expensive)
- Automatic fallback to next cheapest on failure
- Zero maintenance — future providers included automatically

## Tasks

### Phase 1: Config Update
- [ ] **Task 1.1**: Update model identifier in `/Users/warren/.hermes/litellm/config.yaml`
  - Change `model: openrouter/deepseek/deepseek-v4-flash` → `model: openrouter/deepseek/deepseek-v4-flash-0731:floor`
  - Version pin `0731` ensures consistent model; `:floor` enables price sorting

- [ ] **Task 1.2**: (Optional) Add `max_price` ceiling for cost guardrail
  ```yaml
  extra_body:
    provider:
      max_price:
        prompt: 0.10
        completion: 0.20
  ```

### Phase 2: Deploy & Verify
- [ ] **Task 2.1**: Restart LiteLLM proxy
  ```bash
  docker restart litellm-proxy && sleep 5
  ```

- [ ] **Task 2.2**: Verify model appears in `/v1/models`
  ```bash
  curl -s http://localhost:4000/v1/models | grep t2c-orchestrator-blend
  ```

- [ ] **Task 2.3**: Test routing with a sample request
  ```bash
  curl -X POST http://localhost:4000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "t2c-orchestrator-blend", "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 50}'
  ```
  - Check response `provider` field shows cheapest provider (should be DeepInfra or StreamLake)

### Phase 3: Fallback Chain Validation
- [ ] **Task 3.1**: Verify fallback chain order unchanged
  ```
  t2-orchestrator (Nemotron free)
    → t2b-orchestrator-cheapest (DeepInfra direct, guaranteed $0.08/$0.18)
    → t2c-orchestrator-blend (OpenRouter :floor, dynamic cheapest)
    → t2a-orchestrator-deepseek (DeepSeek direct)
    → e1-fallback (Groq)
  ```

- [ ] **Task 3.2**: Simulate failure on primary → verify DeepInfra direct still preferred over OR blend

## Acceptance Criteria
- [ ] `t2c-orchestrator-blend` model uses `:floor` suffix in config
- [ ] LiteLLM proxy restarts successfully
- [ ] Test request routes through OpenRouter with price-sorted providers
- [ ] Fallback chain order preserved
- [ ] No regression in primary (Nemotron) or first fallback (DeepInfra direct)

## Rollback
If issues:
1. Revert model identifier to `openrouter/deepseek/deepseek-v4-flash`
2. Restart proxy
3. Fallback chain remains functional via DeepInfra direct

## Files Modified
- `/Users/warren/.hermes/litellm/config.yaml` (single line change)

## Estimated Effort
- Config change: 2 min
- Restart + verify: 3 min
- Total: ~5 minutes