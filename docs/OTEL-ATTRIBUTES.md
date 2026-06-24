# EdgeGDE OpenTelemetry Attribute Conventions

Locked attribute namespaces for spans emitted by EdgeGDE components.

## Namespace: `app.*`

EdgeGDE domain attributes shared across all spans (worker, agent, queue).

| Attribute             | Type   | Required | Description                              |
|-----------------------|--------|----------|------------------------------------------|
| `app.correlation.id`  | string | **yes**  | Durable correlation ID linking trace to audit event |
| `app.tenant.id`       | string | yes      | Tenant identifier                        |
| `app.mission.id`      | string | no       | Mission/workflow identifier              |
| `app.action.id`       | string | **yes**  | Specific action within a mission         |
| `app.phase`           | string | no       | Lifecycle phase: `execute`, `verify`, `compensate` |

## Namespace: `http.*`

Standard HTTP semantic conventions (OTel-compliant).

| Attribute             | Type   | Source          |
|-----------------------|--------|-----------------|
| `http.method`         | string | request.method  |
| `http.url`            | string | request.url     |
| `http.route`          | string | URL pathname    |
| `http.status_code`    | int    | response.status |
| `http.duration_ms`    | double | performance.now |
| `http.host`           | string | request host    |

## Namespace: `messaging.*`

Standard messaging conventions (queue spans).

| Attribute                  | Type   | Description              |
|----------------------------|--------|--------------------------|
| `messaging.system`         | string | `cloudflare_queues`      |
| `messaging.destination`    | string | Queue name               |
| `messaging.batch_size`     | int    | Messages in batch        |
| `messaging.duration_ms`    | double | Handler execution time   |

## Resource attributes

| Attribute            | Description                          |
|----------------------|--------------------------------------|
| `service.name`       | `edgegde-worker` / `edgegde-hermes-agent` |
| `service.namespace`  | Tenant ID for multi-tenant scope     |
| `deployment.environment` | `local`, `staging`, `production` |

---

## Policies

### 1. Action ↔ Trace Binding (enforced)

Every EdgeGDE action MUST emit a trace with the same `app.correlation.id` as its
audit event. This is not optional — it is the invariant that turns telemetry into
replayable execution history.

**Rule:**
```
Every executed action → MUST emit a trace with matching correlationId → 
trace AND audit event MUST share the same app.correlation.id
```

**Consequence of violation:**
Traces that cannot be joined to audit events are noise. A span without
`app.correlation.id` will be dropped in production-level queries.

**Enforcement mechanism (planned):**
- Action Durable Object lifecycle callback at `afterExecute` that validates
  `correlationId` presence in the emitted span
- CI gate in PRs that modifies action handlers without trace emission

### 2. Sampling Strategy

**Current: capture everything, no sampling.**

| Signal    | Sample rate | Rationale                                 |
|-----------|-------------|-------------------------------------------|
| Actions   | 1.0 (100%)  | Must never lose action traces              |
| Errors    | 1.0 (100%)  | Every error is a signal                    |
| HTTP reqs | 1.0 (100%)  | Low volume today, re-evaluate at >10K/day |
| LLM calls | 1.0 (100%)  | Agent decision traceability                |
| Queue     | 1.0 (100%)  | Low volume                                 |

**Future threshold:** When any signal exceeds 10,000 spans/day, introduce
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` and
`OTEL_TRACES_SAMPLER_ARG=0.1` for low-level HTTP spans only.
Actions, errors, and LLM calls are NEVER sampled.

### 3. Signals Separation

SigNoz supports three signals. Each has a distinct producer and purpose:

| Signal  | Producer                          | Purpose                         | Storage           |
|---------|-----------------------------------|---------------------------------|-------------------|
| Traces  | `otel-worker.ts`, traceloop SDK   | Action execution, LLM calls     | signoz_traces.*   |
| Metrics | `src/lib/metrics.ts`              | Request counts, latency, cost   | signoz_metrics.*  |
| Logs    | Cloudflare Workers observability  | Debug events, console output    | signoz_logs.*     |

**Rule for developers:**
- Execution flow → traces (always with `app.correlation.id`)
- Aggregated counters → metrics (`incrementRequest`, `flushMetrics`)
- Debug/info messages → logs (console.warn/info/error)

Do not log what should be traced. Do not trace what should be metered.

---

## Enforcement

Every EdgeGDE action MUST emit a trace with the same `app.correlation.id` as its
audit event. This binding is what turns telemetry into replayable execution
history.

## Producers

| Component        | Library                    | Spans emitted |
|------------------|----------------------------|---------------|
| EdgeGDE Worker   | `src/lib/otel-worker.ts`   | HTTP request, queue |
| Hermes Agent     | `traceloop.sdk` (OpenLLMetry) | LLM calls, tool calls |
