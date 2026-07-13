#!/bin/bash
# Seed affirmco tenant in staging KV
set -e

ENV="--env staging"
BIND="--binding TENANT_KV"

cd /Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime

echo "=== Seeding affirmco tenant ==="

# 1. Tenant metadata
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico" \
  '{"tenantId":"au-mortgage-broker-afirmico","slug":"au-mortgage-broker-afirmico","name":"AFIRMICO Finance","createdAt":"2026-06-01T00:00:00.000Z","plan":"pro","verified":true}' > /dev/null 2>&1
echo "  ✅ tenant meta"

# 2. Chat config (enables the widget)
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico:chat:config" \
  '{"tenantId":"au-mortgage-broker-afirmico","name":"AFIRMICO Finance","objective":"Broker customer intake","fields":[{"fieldName":"fullName","label":"Full Name","fieldType":"text"},{"fieldName":"mobile","label":"Mobile Number","fieldType":"tel"},{"fieldName":"loanPurpose","label":"Loan Purpose","fieldType":"select"}],"priorityOrder":["fullName","mobile","loanPurpose"],"knowledgeBase":{"topics":["rates","products","policy","fees","compliance","general"]},"ui":{"title":"AFIRMICO Finance","greeting":"Welcome to AFIRMICO Finance","colorAccent":"#58a6ff"}}' > /dev/null 2>&1
echo "  ✅ chat config"

# 3. Default layout (required for page render)
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico:layout:latest" \
  '{"type":"Page","children":[{"type":"Header","props":{"logo":"AFIRMICO Finance","links":["Home","Products","Contact"]}},{"type":"Section:Hero","props":{"title":"AFIRMICO Finance","subtitle":"Powered by EdgeGDE"}},{"type":"Footer"}]}' > /dev/null 2>&1
echo "  ✅ default layout"

# 4. Design tokens
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico:design" \
  '## Colors\nprimary: #58a6ff\nbackground: #0d1117\ntext: #e1e4e8' > /dev/null 2>&1
echo "  ✅ design tokens"

# 5. Site config
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico:site" \
  '{"title":"AFIRMICO Finance","tenant":"au-mortgage-broker-afirmico","theme":"dark-midnight","pages":{"home":{"content":"<h2>Welcome to AFIRMICO Finance</h2><p>Your trusted mortgage broker.</p>"},"calculators":{"content":"<h2>Calculators</h2>"}}}' > /dev/null 2>&1
echo "  ✅ site config"

# 6. Credentials (minimal)
npx wrangler kv key put $ENV $BIND \
  "tenant:au-mortgage-broker-afirmico:credentials" \
  '{"passwordHash":"seed","apiKeyHash":"seed","createdAt":"2026-06-01T00:00:00.000Z"}' > /dev/null 2>&1
echo "  ✅ credentials"

echo ""
echo "=== Verifying ==="
npx wrangler kv key get $ENV $BIND "tenant:au-mortgage-broker-afirmico" 2>&1 | head -1
echo "Tenant seeded successfully!"
