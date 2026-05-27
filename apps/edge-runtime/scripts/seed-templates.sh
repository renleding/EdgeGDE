#!/usr/bin/env bash
# EdgeGDE — Seed quick_refi_v1 template
# Run: bun run seed-templates
set -e

BASE="${1:-http://localhost:8787}"
TOKEN="${2:-edgegde-dev-token-2026}"

echo "Seeding quick_refi_v1 template..."

curl -s -X POST "${BASE}/api/v1/admin/templates" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
  "id": "quick_refi_v1",
  "name": "Quick Refinance Quote",
  "category": "mortgage",
  "design": "## Colors\nprimary: #1a73e8\nbackground: #ffffff\ntext: #111111",
  "layout": {
    "id": "quick_refi_v1",
    "type": "Page",
    "props": {
      "title": "Quick Refinance Quote",
      "description": "See if you could save by refinancing your current home loan."
    },
    "children": [
      {
        "id": "main_container",
        "type": "Container",
        "props": { "layout": "stack", "spacing": "large", "maxWidth": 640, "align": "center" },
        "children": [
          {
            "id": "header_text",
            "type": "Text",
            "props": { "content": "Find out how much you could save.", "variant": "h2", "align": "center" }
          },
          {
            "id": "refinance_form",
            "type": "Form",
            "props": { "method": "POST", "action": "/api/v1/tenant/data-ingest", "submitLabel": "Get My Quote", "successMessage": "Thanks! A broker will be in touch shortly with your quote." },
            "children": [
              {
                "id": "loan_details_section",
                "type": "Container",
                "props": { "layout": "grid", "columns": 2, "spacing": "medium", "title": "Loan Details" },
                "children": [
                  { "id": "property_value", "type": "TextInput", "props": { "label": "Estimated Property Value ($)", "name": "property_value", "required": true, "inputMode": "numeric", "placeholder": "800000" } },
                  { "id": "loan_balance", "type": "TextInput", "props": { "label": "Current Loan Balance ($)", "name": "loan_balance", "required": true, "inputMode": "numeric", "placeholder": "500000" } },
                  { "id": "interest_rate", "type": "TextInput", "props": { "label": "Current Interest Rate (%)", "name": "interest_rate", "inputMode": "decimal", "placeholder": "6.5" } },
                  { "id": "property_type", "type": "Select", "props": { "label": "Property Type", "name": "property_type", "required": true, "options": [{ "label": "Owner Occupier", "value": "owner_occupier" }, { "label": "Investment", "value": "investment" }] } },
                  { "id": "timeline", "type": "RadioGroup", "props": { "label": "When are you looking to refinance?", "name": "timeline", "required": true, "options": [{ "label": "ASAP", "value": "asap" }, { "label": "1-3 months", "value": "soon" }, { "label": "Just exploring", "value": "exploring" }] } }
                ]
              },
              {
                "id": "contact_section",
                "type": "Container",
                "props": { "layout": "stack", "spacing": "medium", "title": "Contact Details" },
                "children": [
                  { "id": "first_name", "type": "TextInput", "props": { "label": "First Name", "name": "first_name", "required": true } },
                  { "id": "last_name", "type": "TextInput", "props": { "label": "Last Name", "name": "last_name", "required": true } },
                  { "id": "email", "type": "TextInput", "props": { "label": "Email Address", "name": "email", "type": "email", "required": true } },
                  { "id": "phone", "type": "TextInput", "props": { "label": "Phone Number", "name": "phone", "type": "tel", "required": true } },
                  { "id": "correlation", "type": "HiddenInput", "props": { "name": "_test_correlation" } }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}'

echo ""
echo "Done."
