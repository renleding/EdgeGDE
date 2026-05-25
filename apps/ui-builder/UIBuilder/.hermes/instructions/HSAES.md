# ===========================================================================
# 📘 EdgeGDE Hermes System Architecture & Execution Specification (HSAES)
# ===========================================================================
# Status: 100/100 Deterministic & Agent-Safe
# Target: Cloudflare Workers (V8 Isolates)

🔷 0. SYSTEM OVERVIEW
System Name: EdgeGDE
Type: Edge‑native computation + UI compiler platform
Runtime Target: Cloudflare Workers (V8 Isolates)
Framework Stack: Hono + HTMX
Execution Model: Stateless hot path + async background pipelines
Deployment Model: Multi‑tenant, registry-driven, globally distributed

🔷 1. CORE SYSTEM INVARIANTS (MANDATORY)
These rules MUST NEVER be violated.

✅ 1.1 Zero Blocking Execution
All request handlers MUST NOT:
- call external APIs in the hot path
- block on database reads
- perform long-running computation
All external work MUST use: ctx.waitUntil()

✅ 1.2 Deterministic Build System
ALL runtime artifacts MUST be generated from:
YAML DSL → Compiler → Source Files
No manual runtime logic injection allowed.

✅ 1.3 Registry Authority
ALL tools, schemas, and MCP interfaces MUST originate from: CALCULATOR_REGISTRY
No duplication across routes, MCP layer, or UI.

✅ 1.4 Multi-Tenant Isolation
Tenant identity = request hostname
Each request MUST: host → KV lookup → brand config
Failure: return 404

✅ 1.5 Stateless Runtime
Workers MUST remain stateless
State allowed only in:
- KV (distributed cache)
- Durable Objects (atomic coordination)
- R2 / D1 (optional storage layers)

🔷 2. SYSTEM EXECUTION DAG
[1] Schema Input (OpenPencil)
        ↓
[2] Compiler Engine
        ↓
[3] Staging Layer
        ↓
[3.5] Edge Runtime Validation ✅
        ↓
[4] Deployment (Wrangler)
        ↓
[5] Runtime Execution
        ↓
[6] Observability Logging
        ↓
[6.5] Feedback Loop ✅

🔷 3. PHASE DEFINITIONS

✅ PHASE 1 — SCHEMA STABILIZATION
INPUT: .op JSON (OpenPencil export)
OUTPUT: Validated schema objects
RULES:
- Must pass Zod validation
- Must be versioned (schemaVersion)
- Must fail fast on mismatch

✅ PHASE 2 — COMPILER ENGINE
INPUT: Validated schema objects
OUTPUT: JSX/TSX components, HTMX attributes, MCP annotations
REQUIRED TRANSFORMATIONS:
  UI: Layout → Tailwind classes
  Interaction: Inject hx-post, hx-target, hx-swap
  MCP: Inject mcp-tool, mcp-description, mcp-params, protocolVersion
HARD RULES:
- No runtime branching logic
- Output must be deterministic
- No direct KV / DB references

✅ PHASE 3 — STAGING LAYER
OUTPUT DIRECTORY: src/routes/staged/
RULES:
- Production routes MUST NOT be overwritten during automated generation.
- Output files must pass strict type-checking and build verification layers.
REQUIRED COMMANDS:
  bun install
  bun run build

✅ PHASE 3.5 — EDGE RUNTIME VALIDATION (CRITICAL)
COMMAND: wrangler dev --remote --port 8787
VALIDATION CHECKS:
- KV namespaces and bindings resolve correctly.
- Durable Objects initialize without system collision.
- Zero unhandled runtime exceptions on baseline endpoints.
FAILURE ACTION:
- Kills the process thread, BLOCKS the pipeline, and returns an atomic error log.

✅ PHASE 4 — DEPLOYMENT
COMMAND: wrangler deploy
OUTPUT: Live Cloudflare Worker (global edge network)

✅ PHASE 4.5 — RECOVERY & FAILSAFE LAYER
REQUIRED CAPABILITIES:
- Rollback: wrangler rollback <deployment-id>
- Fallback Data Strategy: IF ingestion fails: USE lastKnownGood KV value
- Circuit Breaker: IF endpoint fails repeatedly: disable endpoint for X interval
- Safe Defaults: System MUST have fallback baseline values

✅ PHASE 5 — RUNTIME EXECUTION
REQUEST FLOW:
Request → Middleware → Tenant Resolution → Registry → Execution → Response

HEALTH ENDPOINT:
GET /healthz
REQUIREMENTS:
- MUST return HTTP 200 always.
- MUST NOT depend on tenant state.
- MUST NOT require KV.
- MUST confirm runtime availability only.

EXECUTION STEPS:
1. Extract hostname
2. Load brand from KV
3. Resolve tool from registry
4. Validate input (Zod)
5. Execute computation
6. Return: JSON (agent) OR HTML fragment (HTMX)
RULES:
- No external fetch
- No blocking IO
- No mutable state

✅ PHASE 5.1 — RATE LIMITING (ATOMIC)
REQUIRED: Durable Object Rate Limiter
LOGIC:
IF requests > threshold: RETURN 429
ELSE: PASS

✅ PHASE 6 — OBSERVABILITY
LOG FORMAT:
{ "level": "INFO|WARN|ERROR", "type": "event_type", "message": "string", "timestamp": number }
STORAGE: TELEMETRY_KV
RULES:
- Logging MUST be async
- MUST NOT block request

✅ PHASE 6.5 — FEEDBACK LOOP (SELF-OPTIMIZATION)
FLOW: Telemetry → Analyzer → Compiler Updates

🔷 4. MULTI-TENANT CONTROL
TENANT RESOLUTION: hostname → brand config
STORAGE: KV namespace (brand:<host>)
RULES: strict isolation, no cross-tenant access

🔷 5. MCP (AGENT INTERFACE CONTRACT)
DISCOVERY ROUTE: GET /.well-known/mcp.json
CACHE RULE: MUST be cacheable at edge (TTL >= 60s)
REQUIRED STRUCTURE:
{
  "protocolVersion": "2026-05-17",
  "tools": [
    {
      "name": "calculate_mortgage",
      "description": "Computes Australian-compliant variable and fixed mortgage loan rates.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "principal": { "type": "number", "description": "Total loan amount in AUD" }
        },
        "required": ["principal"]
      }
    }
  ]
}
RULES:
- Must match CALCULATOR_REGISTRY exactly (single source of truth).
- Must be deterministic and versioned.

🔷 6. CI/CD PIPELINE (HEADLESS INTERACTION CONTRACT)
RULES:
- Wrangler MUST run in API token mode only.
- OAuth MUST NOT be used.

TRIGGER:
  push:
    branches: [main]

PIPELINE:
jobs:
  build_and_verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      
      - name: Install & Type-Check
        run: |
          bun install --frozen-lockfile
          bun x tsc --noEmit
          
      - name: Local Compiling Sanity Check
        run: bun run build

  edge_validation_and_deploy:
    runs-on: ubuntu-latest
    needs: build_and_verify
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      
      - name: Install Dependencies
        run: bun install --frozen-lockfile

      - name: Install Wrangler
        run: bun install -g wrangler
        
      - name: Start Worker (Deterministic Health Probe)
        run: |
          wrangler dev --remote --port 8787 &
          
          # Wait until server is ready (max 30s)
          for i in {1..30}; do
            if curl -s http://localhost:8787/healthz >/dev/null; then
              echo "✅ Worker ready"
              break
            fi
            sleep 1
          done
          
          # Fail pipeline if health probe fails
          curl -s http://localhost:8787/healthz >/dev/null || exit 1

      - name: Run Test Harness
        run: ./test-harness.sh
          
      - name: Production Isolate Release
        run: wrangler deploy

🔷 7. POLICY GATE (MANDATORY)
ALL MUST PASS:
- TypeScript compile
- Build success
- Edge runtime validation
- Schema validation

TEST HARNESS REQUIREMENT:
- test-harness.sh MUST exist at repository root.
- MUST exit with non-zero status on failure.
- MUST validate:
  - API response
  - HTML response
  - rate limiting
  - ACL rejection

OPTIONAL: Manual approval step

🔷 8. FAILURE CONDITIONS
SYSTEM MUST HANDLE:
- malformed payloads
- KV unavailability
- ingestion failure
- rate limit breaches
- invalid tenant

🔷 9. SUCCESS CRITERIA
System is VALID ONLY IF:
✅ All routes return deterministic outputs
✅ No runtime crashes
✅ Multi-tenant isolation holds
✅ Rate limiting enforced
✅ Agent (MCP) calls succeed via .well-known caching
✅ HTML + HTMX flows render correctly
✅ Deployment is 100% reproducible via Aider DSL without hangs

🏁 FINAL DIRECTIVE FOR HERMES
Hermes MUST:
1. Follow DAG strictly.
2. Never skip validation phases.
3. Never bypass staging.
4. Never introduce runtime blocking logic.
5. Treat registry as single source of truth.
6. Use strictly defined endpoints (e.g., /healthz) for automated verifications.
