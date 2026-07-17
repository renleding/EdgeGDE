#!/usr/bin/env python3
"""
EdgeGDE — Ingest to D1 + Vectorize in one step.

Usage:
  # Ingest a new document (file or raw text)
  python3 ingest-and-vectorize.py --title "My Doc" --type guide --lender "Purple Circle" --file doc.md
  python3 ingest-and-vectorize.py --title "My Doc" --type guide --lender "Purple Circle" --content "document text here"

  # Backfill all docs missing vectors
  python3 ingest-and-vectorize.py --backfill

Environment:
  CLOUDFLARE_API_TOKEN must be set for embedding generation.
"""
import argparse, json, os, subprocess, sys, time, uuid

ACCOUNT_ID = "cdb9bd3391e71153a361515c40e8410f"
D1_DIR     = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime"
D1_CMD     = f"cd {D1_DIR} && npx wrangler d1 execute edgegde-prod --remote --config wrangler.json"

# ---- helpers ---------------------------------------------------------------

def d1(sql: str) -> list[dict]:
    """Run SQL against D1, return results."""
    cmd = f'{D1_CMD} --command {json.dumps(sql)}'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    start = r.stdout.find('[\n')
    if start < 0:
        start = r.stdout.find('[')
    if start >= 0:
        try:
            data = json.loads(r.stdout[start:])
            return data[0].get("results", []) if data else []
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return []

# ---- embedding -------------------------------------------------------------

def embed(text: str) -> list[float] | None:
    """Generate a 768-d embedding for text via Workers AI."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("  ⚠ CLOUDFLARE_API_TOKEN not set — skipping vectorize")
        return None
    truncated = text[:5000]
    payload = json.dumps({"text": [truncated]})
    r = subprocess.run([
        "curl", "-s", "-X", "POST",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Content-Type: application/json",
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5",
        "-d", payload,
    ], capture_output=True, text=True, timeout=30)
    try:
        resp = json.loads(r.stdout)
        if resp.get("success"):
            data = resp.get("result", {})
            if isinstance(data, dict) and "data" in data:
                return data["data"][0]
            if isinstance(data, list) and data:
                return data[0]
    except json.JSONDecodeError:
        pass
    return None

def upsert_vector(doc_id: str, title: str, doc_type: str, word_count: int, values: list[float]):
    """Upsert a single vector to Vectorize."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token or not values:
        return
    payload = json.dumps({"vectors": [{
        "id": f"lender_doc_{doc_id}",
        "values": values,
        "metadata": {"title": title[:128], "doc_type": doc_type, "word_count": word_count},
    }]})
    tmp = "/tmp/vector_single.json"
    with open(tmp, "w") as f:
        f.write(payload)
    subprocess.run([
        "curl", "-s", "-X", "POST",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Content-Type: application/json",
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/edgegde-kb-embeddings/upsert",
        "-d", f"@{tmp}",
    ], capture_output=True, text=True, timeout=30)
    try: os.remove(tmp)
    except: pass

# ---- ingest ----------------------------------------------------------------

def ingest(title: str, doc_type: str, lender: str, content: str) -> str | None:
    """Insert doc into D1 lender_docs, vectorize, return doc_id."""
    if not content or len(content) < 10:
        print("✗ Content too short")
        return None

    doc_id = str(uuid.uuid4())
    wc = len(content.split())
    escaped = content.replace("'", "''")
    title_esc = title.replace("'", "''")

    sql = f"INSERT INTO lender_docs (id, lender_name, doc_type, title, markdown_content, word_count, ingested_at) VALUES ('{doc_id}', '{lender}', '{doc_type}', '{title_esc}', '{escaped}', {wc}, strftime('%Y-%m-%dT%H:%M:%SZ','now'));"
    r = d1(sql)
    print(f"  ✓ D1 inserted: {title} ({wc}w)")

    # Generate embedding
    print("  Generating embedding...")
    vec = embed(content)
    if vec:
        upsert_vector(doc_id, title, doc_type, wc, vec)
        print(f"  ✓ Vectorize upserted")
    else:
        print("  ⚠ Embedding skipped")

    return doc_id

# ---- backfill (reuse from vectorize-backfill.py) ---------------------------

def backfill(limit: int = 0, dry_run: bool = False):
    """Backfill all docs that may not have vectors."""
    docs = d1("SELECT id, title, doc_type, word_count, substr(markdown_content, 1, 5000) as short_content FROM lender_docs ORDER BY word_count DESC")
    print(f"Found {len(docs)} documents")

    if limit > 0:
        docs = docs[:limit]

    # Filter to docs NOT already in vectorize (check by listing existing vector IDs)
    existing = set()
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if token:
        r = subprocess.run([
            "npx", "wrangler", "vectorize", "list-vectors", "edgegde-kb-embeddings",
            "--config", f"{D1_DIR}/wrangler.json",
        ], capture_output=True, text=True, timeout=30, cwd=D1_DIR)
        for line in r.stdout.split('\n'):
            if 'lender_doc_' in line:
                eid = line.strip().split()[-1]
                existing.add(eid)

    to_process = [d for d in docs if f"lender_doc_{d['id']}" not in existing]
    print(f"Need vectors for {len(to_process)} docs ({len(existing)} already have vectors)")

    if dry_run:
        for d in to_process[:20]:
            print(f"  {d['id'][:8]}  {d['title'][:55]}")
        if len(to_process) > 20:
            print(f"  ... and {len(to_process)-20} more")
        return

    batch = []
    texts = []
    for d in to_process:
        content = d.get("short_content", "")
        if not content or len(content) < 20:
            continue
        texts.append(content)
        batch.append({"id": f"lender_doc_{d['id']}", "metadata": {"title": d["title"][:128], "doc_type": d["doc_type"], "word_count": d.get("word_count", 0)}})

    # Generate in batches of 5
    for i in range(0, len(texts), 5):
        batch_texts = texts[i:i+5]
        batch_meta = batch[i:i+5]
        payload = json.dumps({"text": [t[:5000] for t in batch_texts]})
        r = subprocess.run([
            "curl", "-s", "-X", "POST",
            "-H", f"Authorization: Bearer {token}",
            "-H", "Content-Type: application/json",
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5",
            "-d", payload,
        ], capture_output=True, text=True, timeout=60)
        try:
            resp = json.loads(r.stdout)
            if resp.get("success"):
                data = resp["result"]
                if isinstance(data, dict):
                    data = data.get("data", [])
                vectors = [{"id": batch_meta[j]["id"], "values": data[j], "metadata": batch_meta[j]["metadata"]} for j in range(min(len(data), len(batch_meta)))]
                upsert_vectors_batch(vectors)
        except (json.JSONDecodeError, IndexError, KeyError):
            print(f"  ⚠ Embedding API error for batch {i//5}")

        if (i + 5) % 20 == 0:
            print(f"  ... {i + 5}/{len(texts)}")
        time.sleep(0.1)

    print(f"✓ Backfill complete")

def upsert_vectors_batch(vectors: list[dict]):
    """Upsert a batch of vectors to Vectorize."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token or not vectors:
        return
    tmp = "/tmp/vector_batch.json"
    with open(tmp, "w") as f:
        json.dump({"vectors": vectors}, f)
    subprocess.run([
        "curl", "-s", "-X", "POST",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Content-Type: application/json",
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/edgegde-kb-embeddings/upsert",
        "-d", f"@{tmp}",
    ], capture_output=True, text=True, timeout=120)
    try: os.remove(tmp)
    except: pass

# ---- CLI -------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ingest to D1 + Vectorize")
    parser.add_argument("--title", help="Document title")
    parser.add_argument("--type", default="guide", help="Doc type: policy/guide/form/faq/other")
    parser.add_argument("--lender", default="Purple Circle Financial Services", help="Lender/source name")
    parser.add_argument("--content", help="Document content (inline)")
    parser.add_argument("--file", help="Document file path (read content from file)")
    parser.add_argument("--backfill", action="store_true", help="Backfill all docs missing vectors")
    parser.add_argument("--dry-run", action="store_true", help="Preview for backfill")
    parser.add_argument("--limit", type=int, default=0, help="Max docs for backfill")
    args = parser.parse_args()

    if args.backfill:
        backfill(limit=args.limit, dry_run=args.dry_run)
        return

    # Get content
    content = args.content
    if args.file:
        with open(args.file) as f:
            content = f.read()

    if not args.title or not content:
        parser.print_help()
        sys.exit(1)

    ingest(args.title, args.type, args.lender, content)

if __name__ == "__main__":
    main()
