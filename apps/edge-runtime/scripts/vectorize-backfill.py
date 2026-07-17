#!/usr/bin/env python3
"""Backfill Vectorize index with embeddings for all D1 lender_docs.

Reads all knowledge docs from D1, generates embeddings via Workers AI (bge-base-en-v1.5),
and upserts to the Vectorize index. Run once to backfill, then call on each new ingestion.

Usage:
  python3 scripts/vectorize-backfill.py
  python3 scripts/vectorize-backfill.py --dry-run   # preview only
"""
import argparse, json, os, subprocess, sys, time, uuid

ACCOUNT_ID = "cdb9bd3391e71153a361515c40e8410f"
API_TOKEN  = os.environ.get("CLOUDFLARE_API_TOKEN", "")
D1_PROD    = "edgegde-prod"
WRANGLER   = "cd /Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime && npx wrangler d1 execute"

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}

def run_sql(sql: str) -> list[dict]:
    """Execute SQL against D1 and return results."""
    cmd = f'{WRANGLER} {D1_PROD} --remote --config wrangler.json --command {json.dumps(sql)}'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    # Extract JSON from wrangler output (skip banner lines, find first '[')
    out = r.stdout
    start = out.find('[\n')
    if start < 0:
        start = out.find('[')
    if start >= 0:
        try:
            data = json.loads(out[start:])
            return data[0].get("results", []) if data else []
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return []

def generate_embeddings(texts: list[str], batch_size: int = 5) -> list[list[float]]:
    """Generate embeddings via Workers AI. Returns list of 768-d vectors."""
    all_vectors = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        # Truncate to ~5000 chars per text (safety margin for 512 token limit)
        truncated = [t[:5000] for t in batch]
        payload = json.dumps({"text": truncated})
        cmd = f"""curl -s -X POST -H 'Authorization: Bearer {API_TOKEN}' -H 'Content-Type: application/json' \
          'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5' \
          -d {json.dumps(payload)}"""
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
        try:
            resp = json.loads(r.stdout)
            if resp.get("success") and "result" in resp:
                data = resp["result"].get("data", resp["result"]) if isinstance(resp["result"], dict) else resp["result"]
                if isinstance(data, list):
                    all_vectors.extend(data)
        except json.JSONDecodeError:
            print(f"  ⚠ Embedding API error for batch {i//batch_size}")
        
        if (i + batch_size) % 20 == 0:
            print(f"  ... embedded {i + batch_size}/{len(texts)}")
        time.sleep(0.1)
    
    return all_vectors

def upsert_vectors(vectors: list[dict]):
    """Upsert vectors to Vectorize via direct REST API (file-based)."""
    tmp = "/tmp/vector_upsert.json"
    with open(tmp, "w") as f:
        json.dump({"vectors": vectors}, f)
    
    r = subprocess.run([
        "curl", "-s", "-X", "POST",
        "-H", f"Authorization: Bearer {API_TOKEN}",
        "-H", "Content-Type: application/json",
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/edgegde-kb-embeddings/upsert",
        "-d", f"@{tmp}",
    ], capture_output=True, text=True, timeout=120)
    try:
        resp = json.loads(r.stdout)
        if resp.get("success"):
            count = resp.get("result", {}).get("count", 0)
            print(f"  ✓ Upsert successful ({count} vectors)")
        else:
            print(f"  ⚠ Upsert error: {resp.get('errors', [])}")
    except json.JSONDecodeError:
        print(f"  ⚠ Upsert parse error: {r.stdout[:200]}")

def main():
    parser = argparse.ArgumentParser(description="Backfill Vectorize with D1 doc embeddings")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--limit", type=int, default=0, help="Max docs to process")
    parser.add_argument("--doc-type", default=None, help="Filter by doc_type")
    args = parser.parse_args()
    
    if not API_TOKEN:
        print("✗ CLOUDFLARE_API_TOKEN not set")
        sys.exit(1)
    
    # Get all docs from D1
    docs = run_sql(f"SELECT id, title, doc_type, word_count, substr(markdown_content, 1, 5000) as short_content FROM lender_docs ORDER BY word_count DESC")
    
    print(f"Found {len(docs)} documents in D1")
    
    if args.limit > 0:
        docs = docs[:args.limit]
        print(f"Limited to {args.limit}")
    
    if args.dry_run:
        print(f"\nWould process {len(docs)} docs:")
        for d in docs:
            print(f"  {d['id'][:8]}  {d['title'][:55]:55s}  {d.get('word_count',0):5d}w  {d.get('doc_type','')}")
        return
    
    # Build vector batch
    batch = []
    texts = []
    for d in docs:
        content = d.get("short_content", "")
        if not content or len(content) < 20:
            continue
        texts.append(content)
        batch.append({
            "id": f"lender_doc_{d['id']}",
            "metadata": {
                "title": d.get("title", "")[:128],
                "doc_type": d.get("doc_type", ""),
                "word_count": d.get("word_count", 0),
            }
        })
    
    print(f"Generating embeddings for {len(texts)} documents...")
    vectors = generate_embeddings(texts)
    
    if len(vectors) != len(batch):
        print(f"⚠ Vector count mismatch: {len(vectors)} vs {len(batch)} docs")
        # Trim to shortest
        n = min(len(vectors), len(batch))
        vectors = vectors[:n]
        batch = batch[:n]
    
    # Combine
    payload = []
    for i in range(len(batch)):
        payload.append({
            "id": batch[i]["id"],
            "values": vectors[i],
            "metadata": batch[i]["metadata"],
        })
    
    print(f"Upserting {len(payload)} vectors to Vectorize...")
    upsert_vectors(payload)
    print(f"✓ Done. {len(payload)} vectors upserted.")

if __name__ == "__main__":
    main()
