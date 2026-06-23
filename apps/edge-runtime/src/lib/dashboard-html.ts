/**
 * EdgeGDE — Master Dashboard HTML
 * Generated from public/dashboard.html.
 * Inlined for Cloudflare Workers (no filesystem at runtime).
 */
export const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeGDE — Master Dashboard</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;padding:24px}
    h1{font-size:20px;color:#f0f6fc;margin-bottom:4px}
    .sub{font-size:12px;color:#8b949e;margin-bottom:24px}
    .section{margin-bottom:28px}
    h2{font-size:15px;color:#58a6ff;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #2d3140}
    .card{background:#161b22;border:1px solid #2d3140;border-radius:8px;padding:14px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
    .card:hover{border-color:#58a6ff}
    .card .info{flex:1}
    .card .title{font-size:13px;color:#f0f6fc;font-weight:500}
    .card .desc{font-size:11px;color:#8b949e;margin-top:2px}
    .card .url{font-size:10px;color:#4a4d55;margin-top:2px;word-break:break-all}
    .card .links{display:flex;gap:6px;flex-shrink:0;margin-left:12px}
    .btn{padding:5px 12px;border-radius:5px;font-size:11px;font-weight:500;text-decoration:none;cursor:pointer;display:inline-block}
    .btn-open{background:#238636;color:#fff;border:none}
    .btn-open:hover{background:#2ea043}
    .btn-copy{background:#1c2128;color:#8b949e;border:1px solid #2d3140}
    .btn-copy:hover{color:#e1e4e8;border-color:#8b949e}
    .btn-warning{background:#d29922;color:#fff;border:none}
    .btn-warning:hover{background:#bb8009}
    .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:6px}
    .badge-prod{background:#238636;color:#fff}
    .badge-staging{background:#d29922;color:#fff}
    .badge-local{background:#8b949e;color:#0d1117}
    .badge-admin{background:#8250df;color:#fff}
    .token-box{background:#1c2128;border:1px solid #2d3140;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;position:relative}
    .token-box .label{color:#8b949e;margin-bottom:4px}
    .token-box .val{color:#3fb950;font-family:monospace;font-size:11px;word-break:break-all}
  </style>
</head>
<body>

<h1>⚡ EdgeGDE — Master Dashboard</h1>
<div class="sub">Version 0.9.3 · Worker: edgegde-calculator · Tenant: au-mortgage-broker-afirmico</div>

<div class="token-box">
  <div class="label">🔑 Admin Token (append ?token=... to any admin URL)</div>
  <div class="val">858ea106ba9379472dfa634b1c630c2e46b525f6</div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<div class="section">
  <h2>📊 Admin Control Plane</h2>

  <div class="card">
    <div class="info">
      <div class="title">Knowledge Base <span class="badge badge-admin">KB</span></div>
      <div class="desc">Ingest via URL or file upload (.html .txt .pdf). Approve/reject entries, delete individual entries or entire topics. Polls pending every 10s.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/admin/kb?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/admin/kb?tenant=au-mortgage-broker-afirmico&token=858ea106ba9379472dfa634b1c630c2e46b525f6" target="_blank">Open</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Policy Rules <span class="badge badge-admin">P4</span></div>
      <div class="desc">Create, edit, toggle, and simulate deterministic policy rules. Simulation panel included.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/admin/rules?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/admin/rules?tenant=au-mortgage-broker-afirmico&token=858ea106ba9379472dfa634b1c630c2e46b525f6" target="_blank">Open</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Audit Export <span class="badge badge-admin">B</span></div>
      <div class="desc">Export compliance audit trail — rules triggered, disclosures shown, per session.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/api/v1/admin/audit/export?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/api/v1/admin/audit/export?tenant=au-mortgage-broker-afirmico&token=858ea106ba9379472dfa634b1c630c2e46b525f6" target="_blank">Open</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Tenant Management <span class="badge badge-admin">T</span></div>
      <div class="desc">List, inspect, sync, and soft-delete tenants. Multi-tenant inheritance admin with search/filter and batch sync.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/admin/tenants</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/admin/tenants?token=858ea106ba9379472dfa634b1c630c2e46b525f6" target="_blank">Open</a>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<div class="section">
  <h2>🚀 Chat Widget & Embed</h2>

  <div class="card">
    <div class="info">
      <div class="title">Production Widget <span class="badge badge-prod">live</span></div>
      <div class="desc">Isolated iframe sandbox — renders AFIRMICO Finance chat with streaming, name labeling, compliance enforcement.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/embed/chat?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/embed/chat?tenant=au-mortgage-broker-afirmico" target="_blank">Open</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Widget Bootstrapper Script <span class="badge badge-prod">v1.0.0</span></div>
      <div class="desc">Versioned embed script served with 1-year cache. Drop into any site for iframe-based chat.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/public/widget.v1.0.0.js</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/public/widget.v1.0.0.js" target="_blank">View</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Chat Streaming API <span class="badge badge-prod">POST</span></div>
      <div class="desc">Streaming endpoint for real-time token-by-token chat responses. Used by the widget.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/api/v1/chat/stream?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText(this.parentElement.parentElement.querySelector('.url').textContent.trim())">Copy</span>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<div class="section">
  <h2>🧮 Calculators</h2>

  <div class="card">
    <div class="info">
      <div class="title">Loan Calculator <span class="badge badge-prod">API</span></div>
      <div class="desc">Stateless mortgage/loan repayment calculation. Input: loan amount, interest rate, term. Returns monthly repayment and totals.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico&tool=default</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('curl -X POST https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico&tool=default -H 'Content-Type: application/json' -d '{"loan_amount": 500000, "interest_rate": 6.15, "term_years": 30}'')">Copy cURL</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Budget Planner <span class="badge badge-prod">live</span></div>
      <div class="desc">Glass-themed budget planner — income vs expenses with surplus/deficit. Full app layout with HTMX.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico&tool=default-budget</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico&tool=budget" target="_blank">Open</a>
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('curl -s -X POST https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico&tool=default-budget -H Content-Type:application/json -d \\'{"income":[{"label":"Salary","amount":8000}],"expenses":[{"label":"Rent","amount":2000}],"period":"monthly"}\\'').then(function(){this.textContent='Copied!'}.bind(this))">cURL</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Calculator Registry <span class="badge badge-prod">system</span></div>
      <div class="desc">Central registry of mortgage, budget, and other calculator tools. Used by the MCP agent system for tool discovery.</div>
      <div class="url">https://github.com/renleding/EdgeGDE/blob/main/apps/edge-runtime/src/registry/calculators.ts</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://github.com/renleding/EdgeGDE/blob/main/apps/edge-runtime/src/registry/calculators.ts" target="_blank">View</a>
    </div>
  </div>
</div>

<div class="section">
  <h2>🌐 Worker Deployments</h2>

  <div class="card">
    <div class="info">
      <div class="title">Production Worker <span class="badge badge-prod">live</span></div>
      <div class="desc">Live worker at edgegde-calculator — all routes, rules engine, compliance, embed.</div>
      <div class="url">https://edgegde-calculator.renleding.workers.dev/</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://edgegde-calculator.renleding.workers.dev/?tenant=au-mortgage-broker-afirmico" target="_blank">Open</a>
      <a class="btn btn-copy" href="https://dash.cloudflare.com/?to=/:account/workers/services/view/edgegde-calculator/production" target="_blank">Dashboard</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Wrangler Deploy Versions <span class="badge badge-staging">CLI</span></div>
      <div class="desc">Rollback, version history, gradual rollout via wrangler CLI.</div>
      <div class="url">npx wrangler versions list</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npx wrangler versions list')">Copy CLI</span>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<div class="section">
  <h2>💻 Local Development</h2>

  <div class="card">
    <div class="info">
      <div class="title">Local Dev Server <span class="badge badge-local">localhost</span></div>
      <div class="desc">Run \`npm run dev\` from apps/edge-runtime — local Wrangler dev server.</div>
      <div class="url">http://localhost:8787/?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('cd apps/edge-runtime && npm run dev')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">System Health Dashboard <span class="badge badge-local">localhost:8899</span></div>
      <div class="desc">Full live system dashboard with service status, resource usage, architecture diagrams, route matrix, and container health.</div>
      <div class="url">http://localhost:8899/system-dashboard.html</div>
    </div>
    <div class="links">
      <span class="btn btn-link" onclick="window.open('http://localhost:8899/system-dashboard.html','_blank')">Open</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">TypeScript Compile Check</div>
      <div class="desc">Run full type check across all source files.</div>
      <div class="url">npx tsc --noEmit</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npx tsc --noEmit')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Run Tests</div>
      <div class="desc">54 tests across scoring engine, hypermedia, domain, and swarm intelligence.</div>
      <div class="url">npm run test</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npm run test')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Lint Check</div>
      <div class="desc">AST firewall — catches direct env.DB/TENANT_KV/VAULT_BUCKET access outside wrappers.</div>
      <div class="url">npm run lint</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npm run lint')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Deploy (patch) <span class="badge badge-staging">auto</span></div>
      <div class="desc">Bump patch → tsc → lint → test → wrangler deploy → git commit → tag → push.</div>
      <div class="url">npm run deploy</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npm run deploy')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Deploy (minor)</div>
      <div class="desc">Bump minor version, same automated pipeline.</div>
      <div class="url">npm run deploy:minor</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npm run deploy:minor')">Copy Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Deploy (wrangler-only)</div>
      <div class="desc">Direct wrangler deploy — skip version bump, git commit, and tests.</div>
      <div class="url">npm run deploy:wrangler</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('npm run deploy:wrangler')">Copy Cmd</span>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<div class="section">
  <h2>🤖 Hermes Agent — Local Ports</h2>

  <div class="card">
    <div class="info">
      <div class="title">Hermes System Dashboard <span class="badge badge-local">8899</span></div>
      <div class="desc">Hermes agent system overview — gateway status, workspace health, provider config, active sessions.</div>
      <div class="url">http://localhost:8899/system-dashboard.html</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="http://localhost:8899/system-dashboard.html" target="_blank">Open</a>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Workspace UI <span class="badge badge-local">3000</span></div>
      <div class="desc">Requires \\\`hermes workspace up\\\` first — manage sessions, view history, configure agents.</div>
      <div class="url">http://localhost:3000</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="http://localhost:3000" target="_blank">Open</a>
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('hermes workspace up').then(function(){this.textContent='Copied!'}.bind(this))">Start Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Local Dev Worker <span class="badge badge-local">8787</span></div>
      <div class="desc">Wrangler local dev server — test changes before deploying. Run from apps/edge-runtime.</div>
      <div class="url">http://localhost:8787/?tenant=au-mortgage-broker-afirmico</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="http://localhost:8787/?tenant=au-mortgage-broker-afirmico" target="_blank">Open</a>
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('cd apps/edge-runtime && npm run dev').then(function(){this.textContent='Copied!'}.bind(this))">Run Cmd</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Hermes Home <span class="badge badge-local">config</span></div>
      <div class="desc">Hermes agent configuration root — workspaces, auth, gateway state, task cache.</div>
      <div class="url">~/.hermes/</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText(process.env.HOME + '/.hermes/').then(function(){this.textContent='Copied!'}.bind(this))">Copy Path</span>
    </div>
  </div>
</div>

<div class="section">
  <h2>📦 Project Structure</h2>

  <div class="card">
    <div class="info">
      <div class="title">Project Root</div>
      <div class="desc">EdgeGDE monorepo — apps/edge-runtime is the worker, packages/ for shared schemas.</div>
      <div class="url">/Users/warren/Documents/_HQ_AI/EdgeGDE</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('/Users/warren/Documents/_HQ_AI/EdgeGDE')">Copy Path</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">Worker Source</div>
      <div class="desc">Hono-based Cloudflare Worker — routes, lib, middleware, queues, objects.</div>
      <div class="url">/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime/src</div>
    </div>
    <div class="links">
      <span class="btn btn-copy" onclick="navigator.clipboard.writeText('/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime/src')">Copy Path</span>
    </div>
  </div>

  <div class="card">
    <div class="info">
      <div class="title">GitHub Repo</div>
      <div class="desc">Source code hosted on GitHub — push via deploy script.</div>
      <div class="url">https://github.com/renleding/EdgeGDE</div>
    </div>
    <div class="links">
      <a class="btn btn-open" href="https://github.com/renleding/EdgeGDE" target="_blank">Open</a>
    </div>
  </div>
</div>

<script>
  // Copy to clipboard helper
  document.querySelectorAll('.btn-copy').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var text = this.dataset.clipboard || this.textContent.trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
          var orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = orig; }, 1500);
        });
      }
    });
  });
</script>
</body>
</html>
`
