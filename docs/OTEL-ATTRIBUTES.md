# EdgeGDE OpenTelemetry Attribute Conventions

Locked attribute namespaces for spans emitted by EdgeGDE components.

## Namespace: `app.*`

EdgeGDE domain attributes shared across all spans (worker, agent, queue).

| Attribute             | Type   | Required | Description                              |
|-----------------------|--------|----------|------------------------------------------|
| `app.correlation.id`  | string | no       | Durable correlation ID linking trace to audit event |
| `app.tenant.id`       | string | no       | Tenant identifier                        |
| `app.mission.id`      | string | no       | Mission/workflow identifier              |
| `app.action.id`       | string | no       | Specific action within a mission         |
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

## Enforcement

Every EdgeGDE action MUST emit a trace with the same `app.correlation.id` as its
audit event. This binding is what turns telemetry into replayable execution
history.

## Producers

| Component        | Library                    | Spans emitted |
|------------------|----------------------------|---------------|
| EdgeGDE Worker   | `src/lib/otel-worker.ts`   | HTTP request, queue |
| Hermes Agent     | `traceloop.sdk` (OpenLLMetry) | LLM calls, tool calls |
