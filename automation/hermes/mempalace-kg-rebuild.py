#!/usr/bin/env python3
"""
MEM-FIX-0002: Deterministic KG rebuild with provenance.

Reads MemPalace drawers (agent/user-profile, agent/memory, warren/diary,
edgegde/*, hermes/*) and extracts typed triples with source_drawer_id
provenance. Idempotent: uses deterministic triple IDs (upsert on conflict).

Usage:
  /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 kg_rebuild.py [--dry-run]

Design:
  - No LLM in the loop: extraction is pattern/rule-based from drawer content.
  - Triples carry: valid_from, confidence=1.0, source_drawer_id, adapter_name,
    extracted_at=now.
  - Idempotent: triple id = sha256(subject|predicate|object)[:16]; INSERT OR REPLACE.
"""
import sqlite3, os, sys, hashlib, datetime, json, re

PALACE_DB = os.path.expanduser('~/.mempalace/palace/chroma.sqlite3')
KG_DB = os.path.expanduser('~/.mempalace/knowledge_graph.sqlite3')
DRY_RUN = '--dry-run' in sys.argv

# --- Load drawers from chroma ---
def load_drawers():
    conn = sqlite3.connect(PALACE_DB)
    cur = conn.cursor()
    # map embedding id -> wing/room/source_file
    meta = {}
    cur.execute("SELECT id, key, string_value FROM embedding_metadata WHERE key IN ('wing','room','source_file')")
    for eid, key, val in cur.fetchall():
        meta.setdefault(eid, {})[key] = val
    # documents: fulltext table holds 'path||->drawer_id' or content; use embedding_fulltext_search rowid aligned with embeddings.id
    docs = {}
    cur.execute("SELECT rowid, string_value FROM embedding_fulltext_search")
    for rowid, val in cur.fetchall():
        docs[rowid] = val
    conn.close()
    drawers = []
    for eid, m in meta.items():
        if eid not in docs:
            continue
        content = docs[eid]
        # strip the 'path||->drawer_id' prefix if present
        if '||->drawer_' in content:
            content = content.split('||->drawer_')[0]
        drawers.append({
            'id': f"drawer_{m.get('wing','?')}_{m.get('room','?')}_{eid}",
            'wing': m.get('wing','?'), 'room': m.get('room','?'),
            'source_file': m.get('source_file',''), 'content': content,
        })
    return drawers

# --- Rule-based extraction ---
# Each rule: (entity_type, predicate) -> regex on content, captures object
RULES = [
    # (regex, subj_type, predicate, obj_fixed_or_None)
    # NOTE: predicate MUST be in Aegis allowed_predicates whitelist:
    # leads, owns, works_on, depends_on, uses_tool, uses_model, contains,
    # references, located_in, governed_by, derived_from, supersedes, expires,
    # has_policy, has_source, has, prefers, values, version, provider, runs,
    # model, expects, cost_conscious, max_retries, backoff_sequence,
    # context_length, drawer_count, self_audits, integration, works_from, works_in
    # Warren identity (agent/user-profile)
    (r'\b(?:I am|my name is|name is|I\'m)\s+([A-Z][a-z]+)', 'person', 'has', None),
    (r'\b(?:mortgage broker|broker)\b', 'person', 'has', 'mortgage_broker'),
    (r'\b(?:Afirmico Finance|Afirmico)\b', 'person', 'has', 'afirmico_finance'),
    (r'\b(?:Purple Circle Financial Services|Purple Circle|ACL\s*486112)\b', 'person', 'has', 'purple_circle_acl_486112'),
    (r'\b(?:Wastar Digital|CRN\s*579832)\b', 'person', 'has', 'wastar_digital'),
    (r'\b(?:Kurri Kurri|NSW)\b', 'person', 'located_in', 'kurri_kurri_nsw'),
    # tools/stack
    (r'\b(?:Salestrekker|salestrekker)\b', 'tool', 'uses_tool', 'salestrekker'),
    (r'\b(?:Cloudflare Workers|CF Workers)\b', 'tool', 'uses_tool', 'cloudflare_workers'),
    (r'\b(?:D1|D1 database)\b', 'tool', 'uses_tool', 'cloudflare_d1'),
    (r'\b(?:Chrome for Testing|CfT)\b', 'tool', 'uses_tool', 'chrome_for_testing'),
    (r'\b(?:Patchright|playwright)\b', 'tool', 'uses_tool', 'patchright'),
    (r'\b(?:Ollama|qwen3-vl|qwen3)\b', 'tool', 'uses_tool', 'ollama_qwen3_vl'),
    (r'\b(?:LiteLLM)\b', 'tool', 'uses_tool', 'litellm'),
    (r'\b(?:Hermes Agent|hermes-agent|Hermes)\b', 'tool', 'uses_tool', 'hermes_agent'),
    (r'\b(?:MemPalace|mempalace)\b', 'tool', 'uses_tool', 'mempalace'),
    (r'\b(?:Ladybug)\b', 'tool', 'uses_tool', 'ladybug_projection'),
    (r'\b(?:Evidence Engine|evidence\.db)\b', 'tool', 'uses_tool', 'evidence_engine'),
    (r'\b(?:State Engine)\b', 'tool', 'uses_tool', 'state_engine'),
    (r'\b(?:kanban)\b', 'tool', 'uses_tool', 'hermes_kanban'),
    (r'\b(?:cua-driver|CUA|computer_use)\b', 'tool', 'uses_tool', 'cua_driver'),
    (r'\b(?:Bitwarden)\b', 'tool', 'uses_tool', 'bitwarden'),
    (r'\b(?:Cubbit)\b', 'tool', 'uses_tool', 'cubbit_ds3'),
    (r'\b(?:cal\.com|Cal Video)\b', 'tool', 'uses_tool', 'cal_com'),
    (r'\b(?:OpenPencil)\b', 'tool', 'uses_tool', 'openpencil'),
    (r'\b(?:openrouter/owl-alpha|owl-alpha)\b', 'tool', 'uses_model', 'openrouter_owl_alpha'),
    # projects/domains
    (r'\b(?:EdgeGDE|edgegde)\b', 'project', 'works_on', 'edgegde'),
    (r'\b(?:PCFS|Purple Circle)\b', 'project', 'works_on', 'pcfs_compliance'),
    (r'\b(?:Diploma of Finance|FNS|TAFE)\b', 'project', 'works_on', 'fns_diploma'),
    (r'\b(?:PCFS Compliance|compliance register)\b', 'project', 'works_on', 'pcfs_compliance_registers'),
    (r'\b(?:test deal|Test Deal v3\.1)\b', 'project', 'runs', 'salestrekker_test_deal_v31'),
    (r'\b(?:ART|Administrative Review Tribunal)\b', 'project', 'references', 'art_nap_appeal'),
    (r'\b(?:child support)\b', 'project', 'references', 'child_support_nap_reversal'),
    (r'\b(?:TAFE NSW|aXcelerate)\b', 'project', 'works_in', 'tafe_nsw_axcelerate'),
    # preferences (from memory drawers)
    (r'\b(?:concise|short|direct)\b.*\b(?:response|answer)\b', 'preference', 'prefers', 'concise_responses'),
    (r'\b(?:local models|local model|no API key)\b', 'preference', 'prefers', 'local_models'),
    (r'\b(?:gogo)\b', 'preference', 'has', 'gogo_execute_immediately'),
    (r'\b(?:State Precedes Action|FRS-007)\b', 'principle', 'governed_by', 'frs007_state_precedes_action'),
    # family (from user profile)
    (r'\b(?:Archer)\b', 'family', 'has', 'archer'),
    (r'\b(?:Stirling)\b', 'family', 'has', 'stirling'),
    (r'\b(?:Michelle)\b', 'family', 'has', 'michelle'),
    (r'\bwarren\.ledingham@gmail\.com\b', 'person', 'has', 'warren_ledingham_gmail'),
]

def make_triple_id(subj, pred, obj):
    return hashlib.sha256(f"{subj}|{pred}|{obj}".encode()).hexdigest()[:16]

def extract(drawers):
    triples = []
    seen = set()
    for d in drawers:
        content = d['content']
        drawer_id = d['id']
        if not content or len(content) < 20:
            continue
        for pattern, subj_type, pred, obj_fixed in RULES:
            m = re.search(pattern, content, re.IGNORECASE)
            if not m:
                continue
            if obj_fixed:
                obj = obj_fixed
            else:
                obj = m.group(1).lower().replace(' ', '_')
            # subject: warren for person rules; use entity name for others
            if subj_type == 'person':
                subj = 'warren'
            elif subj_type == 'tool':
                subj = 'warren'
            elif subj_type == 'project':
                subj = 'warren'
            elif subj_type == 'preference':
                subj = 'warren'
            tid = make_triple_id(subj, pred, obj)
            if tid in seen:
                continue
            seen.add(tid)
            triples.append({
                'id': tid, 'subject': subj, 'predicate': pred, 'object': obj,
                'valid_from': '2026-01-01', 'valid_to': None,
                'confidence': 1.0, 'source_drawer_id': drawer_id,
                'adapter_name': 'mempalace-kg-rebuild-v1',
                'extracted_at': datetime.datetime.utcnow().isoformat(),
            })
    return triples

def upsert(triples):
    conn = sqlite3.connect(KG_DB)
    cur = conn.cursor()
    # ensure entities exist
    entities = set()
    for t in triples:
        entities.add(t['subject']); entities.add(t['object'])
    for e in entities:
        cur.execute("INSERT OR IGNORE INTO entities (id, name, type) VALUES (?,?,?)",
                    (e, e.replace('_',' '), 'unknown'))
    n = 0
    for t in triples:
        cur.execute("""INSERT OR REPLACE INTO triples
            (id, subject, predicate, object, valid_from, valid_to, confidence,
             source_closet, source_file, source_drawer_id, adapter_name, extracted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (t['id'], t['subject'], t['predicate'], t['object'], t['valid_from'],
             t['valid_to'], t['confidence'], None, None, t['source_drawer_id'],
             t['adapter_name'], t['extracted_at']))
        n += 1
    conn.commit()
    conn.close()
    return n

def main():
    drawers = load_drawers()
    print(f"Loaded {len(drawers)} drawers")
    triples = extract(drawers)
    print(f"Extracted {len(triples)} candidate triples")
    # dedupe by (subject,predicate,object) keeping first
    seen = {}
    for t in triples:
        key = (t['subject'], t['predicate'], t['object'])
        if key not in seen:
            seen[key] = t
    final = list(seen.values())
    print(f"After dedupe: {len(final)} unique triples")
    prov = sum(1 for t in final if t['source_drawer_id'])
    print(f"With provenance: {prov} ({100*prov//max(len(final),1)}%)")
    if DRY_RUN:
        for t in final[:20]:
            print(f"  {t['subject']} -[{t['predicate']}]-> {t['object']}  (src={t['source_drawer_id'][:40]}...)")
        return
    n = upsert(final)
    conn = sqlite3.connect(KG_DB)
    total = conn.execute("SELECT COUNT(*) FROM triples").fetchone()[0]
    ents = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    prov_cnt = conn.execute("SELECT COUNT(*) FROM triples WHERE source_drawer_id IS NOT NULL AND source_drawer_id != ''").fetchone()[0]
    conn.close()
    print(f"UPSERTED {n} triples. KG now: {total} triples, {ents} entities, {prov_cnt} with provenance")

if __name__ == '__main__':
    main()
