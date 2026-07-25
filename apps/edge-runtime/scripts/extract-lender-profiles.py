#!/usr/bin/env python3
"""
Lender criteria extraction pipeline.

For each real lender, reads their docs from D1, extracts 49 criteria fields
using Cloudflare Workers AI (Llama 3.1 8B), and inserts into lender_profiles.
"""

import json, os, subprocess, sys, time, uuid, re

ACCOUNT_ID = "cdb9bd3391e71153a361515c40e8410f"
TOKEN     = os.environ.get("CLOUDFLARE_API_TOKEN", "")
D1_CMD    = "cd /Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime && npx wrangler d1 execute edgegde-prod --remote --config wrangler.json"

SKIP_LENDERS = {
    "ApplyOnline (Simpology)", "Frollo Open Banking", "Salestrekker",
    "Salestrekker 2.0", "Salestrekker 2.0 Training",
    "Broker Education - Salestrekker 2.0", "Purple Circle Financial Services",
    "LoanApp", "Generic Bank",
}

def d1(sql):
    """Run SQL against D1, return results."""
    cmd = f'{D1_CMD} --command {json.dumps(sql)}'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    start = r.stdout.find('[')
    if start >= 0:
        try:
            data = json.loads(r.stdout[start:])
            return data[0].get("results", []) if data else []
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return []

def call_llm(prompt, max_retries=3):
    """Call Workers AI Llama 3.1 8B with retries."""
    payload = json.dumps({
        "prompt": prompt,
        "max_tokens": 4096,
        "temperature": 0.1,
        "stream": False,
    })
    for attempt in range(max_retries):
        r = subprocess.run([
            "curl", "-s", "-X", "POST",
            "-H", f"Authorization: Bearer {TOKEN}",
            "-H", "Content-Type: application/json",
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct-fp8",
            "-d", payload,
        ], capture_output=True, text=True, timeout=120)
        try:
            resp = json.loads(r.stdout)
            if resp.get("success"):
                return resp["result"].get("response", "")
            else:
                err = resp.get("errors", [])
                if any("429" in str(e) for e in err):
                    wait = 2 ** (attempt + 1)
                    print(f"    Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                    continue
                print(f"    LLM error: {err}")
        except (json.JSONDecodeError, KeyError) as e:
            print(f"    Parse error: {e}, stdout: {r.stdout[:200]}")
        time.sleep(1)
    return ""

def get_lender_docs(lender_name, max_docs=4):
    """Get most relevant docs for a lender — medium-length docs (200-3000w) contain criteria, not forms."""
    name_escaped = lender_name.replace("'", "''")

    # Prefer docs in 150-3000 word range (rate sheets, broker guides, policy snippets)
    sql = f"SELECT title, doc_type, word_count, substr(markdown_content, 1, 3000) as snippet FROM lender_docs WHERE lender_name = '{name_escaped}' AND word_count BETWEEN 150 AND 3000 ORDER BY word_count ASC LIMIT {max_docs}"
    docs = d1(sql)

    # Fallback: any docs for this lender
    if not docs:
        sql = f"SELECT title, doc_type, word_count, substr(markdown_content, 1, 3000) as snippet FROM lender_docs WHERE lender_name = '{name_escaped}' ORDER BY word_count ASC LIMIT {max_docs}"
        docs = d1(sql)

    return docs

def extract_criteria(lender_name, docs):
    """Ask LLM to extract 49 criteria from lender docs."""
    doc_texts = []
    for d in docs:
        doc_texts.append(f"--- {d.get('title','')} ({d.get('doc_type','')}) ---\n{d.get('snippet','')}")

    combined = "\n\n".join(doc_texts)

    prompt = f"""You are a mortgage broker's underwriting analyst. Extract the lending criteria for "{lender_name}" from the following documents.

Return ONLY a valid JSON object with these exact fields (use null for unknown, strings for values):
{{
  "best_for": "what this lender is best suited for",
  "dont_use_for": "scenarios unsuitable for this lender",
  "living_statements": "months of living statements needed",
  "short_emp_probation": "short employment or probation policy",
  "self_emp": "self-employed policy",
  "lo_alt_doc": "low doc / alt doc policy",
  "alt_doc_high_lmi": "alt doc high LMI up to 90%",
  "irregular_income": "irregular income policy",
  "overtime": "overtime policy",
  "bonuses": "bonuses policy",
  "allowances": "allowances policy",
  "maternity_leave": "maternity leave policy",
  "foreign_income": "foreign income policy",
  "floor_buffer": "assessment rate floor or buffer",
  "dti": "debt-to-income ratio limit",
  "rent_percent": "rental income percentage",
  "actual_payment_reducer": "actual payment as common debt reducer",
  "credit_score": "minimum credit score",
  "lvr": "maximum LVR",
  "lmi_insurer": "LMI insurer details",
  "lmi_waiver": "LMI waiver policy",
  "lmi_95_include": "LMI 95% inclusion",
  "lmi_98_capitalise": "LMI 98% capitalisation",
  "cash_out_max_pct": "max cash-out percentage",
  "non_genuine_savings": "non-genuine savings policy",
  "interest_rate_type": "fixed/variable interest rate types available",
  "construction": "construction lending policy",
  "smsf": "SMSF lending policy",
  "commercial": "commercial lending",
  "commercial_debt": "commercial debt policy",
  "commercial_add_backs": "commercial add backs policy",
  "under_40sqm": "under 40sqm property policy",
  "over_2m_purchase": "over $2M purchase policy",
  "agri_rural": "agricultural / rural property",
  "vacant_land_only": "vacant land only policy",
  "free_upfront_val": "free upfront valuation available",
  "fhlds": "First Home Loan Deposit Scheme eligibility",
  "non_resident": "non-resident policy",
  "visa_type": "acceptable visa types",
  "family_guarantee": "family guarantee policy",
  "family_tax_govt": "family tax / government benefits",
  "favourable_purchase_family": "favourable purchase from family",
  "age_55_plus": "55+ policy",
  "age_end_loan_term": "max age at end of loan term",
  "bridging": "bridging finance policy",
  "one_yr_financials": "1-year financials requirement",
  "arrears_defaults": "arrears / defaults policy",
  "pricing": "pricing notes",
  "digital_sign": "digital signature support",
  "notes": "any other notable criteria"
}}

DOCUMENTS:
{combined}

Return ONLY the JSON object, no other text."""

    print(f"    Calling LLM...")
    response = call_llm(prompt)

    # Extract JSON from response
    json_match = re.search(r'\{.*\}', response, re.DOTALL)
    if json_match:
        try:
            data = json.loads(json_match.group())
            return data
        except json.JSONDecodeError as e:
            print(f"    JSON parse error: {e}")
            print(f"    Response starts: {response[:200]}")
    else:
        print(f"    No JSON found in response")
        print(f"    Response starts: {response[:200]}")
    return {}

def insert_profile(lender_name, criteria):
    """Insert or update a lender profile in D1."""
    if not criteria:
        print(f"    No criteria extracted, skipping insert")
        return False

    profile_id = str(uuid.uuid4())

    # Build column list and values, escaping single quotes
    cols = ["id", "lender_name"]
    vals = [f"'{profile_id}'", f"'{lender_name.replace(chr(39), chr(39)+chr(39))}'"]

    for field, value in criteria.items():
        if value is not None and value != "":
            field_clean = field.replace("'", "")
            val_clean = str(value).replace("'", "''")
            cols.append(field_clean)
            vals.append(f"'{val_clean}'")

    sql = f"INSERT INTO lender_profiles ({', '.join(cols)}) VALUES ({', '.join(vals)})"

    cmd = f'{D1_CMD} --command {json.dumps(sql)}'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
    success = '"success": true' in r.stdout
    if success:
        print(f"    ✓ Profile created")
    else:
        print(f"    ✗ Insert error: {r.stdout[:200]}")
    return success

def main():
    if not TOKEN:
        print("CLOUDFLARE_API_TOKEN not set")
        sys.exit(1)

    # Get all lender names
    all_lenders = d1("SELECT lender_name, COUNT(*) as cnt FROM lender_docs GROUP BY lender_name ORDER BY lender_name")

    # Filter to real lenders
    lenders = [l for l in all_lenders if l["lender_name"] not in SKIP_LENDERS]
    print(f"Processing {len(lenders)} lenders (skipped {len(all_lenders) - len(lenders)} non-lender entries)\n")

    success_count = 0
    fail_count = 0
    already_count = 0

    for i, lender in enumerate(lenders, 1):
        name = lender["lender_name"]
        cnt = lender["cnt"]

        # Check if profile already exists
        existing = d1(f"SELECT id FROM lender_profiles WHERE lender_name = '{name.replace(chr(39), chr(39)+chr(39))}'")
        if existing:
            print(f"[{i}/{len(lenders)}] {name:40s} ⏭ already exists")
            already_count += 1
            continue

        print(f"[{i}/{len(lenders)}] {name:40s} ({cnt} docs)", end="")

        docs = get_lender_docs(name)
        if not docs:
            print(f"    ⚠ No docs found, skipping")
            fail_count += 1
            continue

        print(f"  {len(docs)} docs selected")

        criteria = extract_criteria(name, docs)
        if not criteria:
            fail_count += 1
            continue

        if insert_profile(name, criteria):
            success_count += 1
        else:
            fail_count += 1

        # Rate limit protection - small delay between lenders
        if i < len(lenders):
            time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"Done. {success_count} created, {already_count} already existed, {fail_count} failed.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
