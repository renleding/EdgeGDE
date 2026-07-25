#!/usr/bin/env python3
"""
EdgeGDE — Batch Lender Document Ingestion Pipeline.

Walks all lender folders under Mortgage Lenders/, extracts PDF/DOCX/XLSX text,
classifies each document by lender + type, inserts into D1 lender_docs,
and triggers Vectorize backfill for semantic search.

Usage:
  # Dry run — show what would be ingested
  python3 scripts/ingest-lender-docs.py --dry-run --limit 5

  # Full ingestion (all ~1,700 docs)
  python3 scripts/ingest-lender-docs.py

  # Incremental — skip already-ingested files
  python3 scripts/ingest-lender-docs.py --incremental

  # Single folder
  python3 scripts/ingest-lender-docs.py --folder "Non Banks_Specialists/Allium Money"

Environment:
  CLOUDFLARE_API_TOKEN must be set for Vectorize embedding generation.
  (Skip set to skip embeddings, only insert to D1.)
"""
import argparse, json, os, re, subprocess, sys, time, uuid

# ── Config ──
BASE_DIR = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/AFIRMICO Documents DB/AFIRMICO - PCFS - LMS Data/Mortgage Lenders"
SCRIPT_DIR = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/edge-runtime"
WRANGLER = f"cd {SCRIPT_DIR} && npx wrangler d1 execute edgegde-prod --remote --config wrangler.json"
MAX_CHUNK_BYTES = 90_000  # per FR-4.1
BATCH_SIZE = 50  # rows per INSERT (FR-5.2)

# ── Doc Type Classification (FR-3.3) ──
DOC_TYPE_RULES = [
    (["application form", "broker accreditation", "accreditation form",
      "loan application", "application"], "form"),
    (["rate card", "interest rate", "pricing", "fee schedule",
      "fees & charges", "fees and charges"], "pricing"),
    (["fact sheet", "product spec", "product specification",
      "product summary", "construction loan"], "product"),
    (["credit policy", "lending policy", "procedure manual",
      "broker guide", "faq", "handbook", "credit policy reference",
      "mortgage lending procedure"], "policy"),
    (["target market determination", "tmd"], "tmd"),
    (["calculator", "serviceability", "worksheet"], "calculator"),
    (["broker pack", "submission checklist", "broker declaration",
      "supporting document"], "broker-guide"),
    (["declaration", "privacy consent", "privacy notice",
      "authority to disclose", "disclosure", "customer needs analysis",
      "customer repayment declaration"], "compliance"),
    (["lmi", "mortgage insurance", "lenders mortgage insurance",
      "lmi guide", "lmi fast facts"], "lmi"),
    (["release", "discharge", "variation"], "form"),
    (["guide", "user guide", "quick guide", "step guide",
      "welcome letter", "welcome pack"], "guide"),
]
DEFAULT_TYPE = "other"

# ── Valid D1 doc_type values (from migration 0023 CHECK constraint) ──
# Accepted: policy, form, guide, faq, other
# We map our extended types to these for the INSERT:
TYPE_MAP = {
    "form": "form",
    "pricing": "other",
    "product": "other",
    "policy": "policy",
    "tmd": "other",
    "calculator": "other",
    "broker-guide": "guide",
    "compliance": "other",
    "lmi": "other",
    "guide": "guide",
    "faq": "faq",
    "other": "other",
}


def classify_doc_type(filename: str) -> tuple[str, str]:
    """Return (extended_type, d1_type) from filename keywords."""
    lower = filename.lower().replace("_", " ").replace("-", " ")
    for keywords, doc_type in DOC_TYPE_RULES:
        for kw in keywords:
            if kw in lower:
                return doc_type, TYPE_MAP.get(doc_type, "other")
    return DEFAULT_TYPE, "other"


def extract_text(filepath: str) -> str | None:
    """Extract readable text from PDF, DOCX, or XLSX. Returns None on failure."""
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext == ".pdf":
            r = subprocess.run(
                ["pdftotext", "-layout", filepath, "-"],
                capture_output=True, text=True, timeout=60
            )
            if r.returncode == 0 and len(r.stdout.strip()) >= 20:
                return r.stdout
            return None

        elif ext in (".docx", ".doc"):
            from docx import Document
            doc = Document(filepath)
            text = "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
            return text if len(text.strip()) >= 20 else None

        elif ext in (".xlsx", ".xls", ".xlsm"):
            import openpyxl
            wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
            ws = wb.worksheets[0]
            rows = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) if c is not None else "" for c in row]
                rows.append(" | ".join(cells))
            text = "\n".join(rows)
            return text if len(text.strip()) >= 20 else None

    except Exception:
        return None


def chunk_text(text: str, title: str) -> list[dict]:
    """Split text into ≤90KB chunks at paragraph breaks (FR-4)."""
    if len(text.encode("utf-8")) <= MAX_CHUNK_BYTES:
        return [{"title": title, "content": text}]

    paragraphs = text.split("\n\n")
    chunks = []
    current = []
    current_bytes = 0
    part = 0

    for para in paragraphs:
        para_bytes = len(para.encode("utf-8"))
        if current_bytes + para_bytes > MAX_CHUNK_BYTES and current:
            part += 1
            total_parts = "?"
            chunks.append({
                "title": f"{title} (part {part}/{{total}})",
                "content": "\n\n".join(current),
            })
            current = [para]
            current_bytes = para_bytes
        else:
            current.append(para)
            current_bytes += para_bytes + 2  # +2 for "\n\n"

    if current:
        part += 1
        chunks.append({
            "title": f"{title} (part {part}/{{total}})",
            "content": "\n\n".join(current),
        })

    total = len(chunks)
    for c in chunks:
        c["title"] = c["title"].replace("{total}", str(total))
    return chunks


def d1_execute(sql: str) -> bool:
    """Execute SQL against D1 via temp file. Returns True on success."""
    tmpfile = f"/tmp/_d1_insert_{uuid.uuid4().hex[:8]}.sql"
    try:
        with open(tmpfile, "w") as f:
            f.write(sql)
        cmd = f'{WRANGLER} --file {tmpfile}'
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
        return '"changed_db": true' in r.stdout and '"success": true' in r.stdout
    except Exception as e:
        sys.stderr.write(f"\n  ⚠ D1 execute error: {e}\n")
        return False
    finally:
        if os.path.exists(tmpfile):
            os.remove(tmpfile)


def get_ingested_paths() -> set[str]:
    """Get set of already-ingested source_path values for incremental mode."""
    tmpfile = f"/tmp/_d1_select_{uuid.uuid4().hex[:8]}.sql"
    try:
        with open(tmpfile, "w") as f:
            f.write("SELECT source_path FROM lender_docs WHERE source_path != '';")
        cmd = f'{WRANGLER} --file {tmpfile}'
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        out = r.stdout
        start = out.find("[{")
        if start >= 0:
            import json
            data = json.loads(out[start:])
            return {row["source_path"] for row in data}
    except Exception:
        pass
    finally:
        if os.path.exists(tmpfile):
            os.remove(tmpfile)
    return set()


def walk_files(folder: str | None = None) -> list[dict]:
    """Walk lender folders and return metadata for each file."""
    files = []
    categories = ["Banks_Mutuals", "Non Banks_Specialists"]

    if folder:
        # Single folder mode: folder is relative to BASE_DIR
        full_path = os.path.join(BASE_DIR, folder)
        if not os.path.isdir(full_path):
            print(f"  ⚠ Folder not found: {full_path}")
            return []
        lender_name = os.path.basename(full_path)
        category = os.path.basename(os.path.dirname(full_path))
        for f in sorted(os.listdir(full_path)):
            ext = os.path.splitext(f)[1].lower()
            if ext in (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".xlsm"):
                source_path = os.path.join(category, lender_name, f)
                files.append({
                    "lender_name": lender_name,
                    "category": category,
                    "filename": f,
                    "filepath": os.path.join(full_path, f),
                    "source_path": source_path,
                })
        return files

    for cat in categories:
        cat_path = os.path.join(BASE_DIR, cat)
        if not os.path.isdir(cat_path):
            continue
        for lender in sorted(os.listdir(cat_path)):
            lender_path = os.path.join(cat_path, lender)
            if not os.path.isdir(lender_path):
                continue
            for f in sorted(os.listdir(lender_path)):
                ext = os.path.splitext(f)[1].lower()
                if ext in (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".xlsm"):
                    source_path = os.path.join(cat, lender, f)
                    files.append({
                        "lender_name": lender,
                        "category": cat,
                        "filename": f,
                        "filepath": os.path.join(lender_path, f),
                        "source_path": source_path,
                    })
    return files


def sanitize_text(text: str) -> str:
    """Remove control characters that break SQL (keep \\n, \\t, \\r)."""
    return ''.join(c for c in text if c == '\n' or c == '\t' or c == '\r' or (ord(c) >= 32) or c == '')


def build_insert_rows(file_meta: dict) -> list[dict]:
    """Extract, classify, chunk a file and return D1 insert rows."""
    filename = file_meta["filename"]
    filepath = file_meta["filepath"]
    lender_name = file_meta["lender_name"]
    source_path = file_meta["source_path"]

    # Extract text
    text = extract_text(filepath)
    if text is None:
        return []

    # Sanitize (remove control chars that break SQL)
    text = sanitize_text(text)

    # Classify
    clean_title = os.path.splitext(filename)[0]
    # Remove _dl suffix from duplicate filenames
    clean_title = re.sub(r'_dl$', '', clean_title)
    extended_type, d1_type = classify_doc_type(clean_title)

    # Chunk
    chunks = chunk_text(text, clean_title)

    word_count = len(text.split())

    rows = []
    for i, chunk in enumerate(chunks):
        chunk_wc = len(chunk["content"].split())
        rows.append({
            "id": str(uuid.uuid4()),
            "lender_name": lender_name,
            "doc_type": d1_type,
            "title": chunk["title"],
            "markdown_content": chunk["content"],
            "word_count": chunk_wc,
            "source_path": source_path,
        })
    return rows


def escape_sql(val: str) -> str:
    """Escape single quotes for SQL."""
    return val.replace("'", "''")


def run():
    parser = argparse.ArgumentParser(description="Ingest lender docs to D1 + Vectorize")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be ingested without writing")
    parser.add_argument("--limit", type=int, default=0, help="Max files to process (0 = all)")
    parser.add_argument("--incremental", action="store_true", help="Skip already-ingested files")
    parser.add_argument("--folder", type=str, help="Process only this subfolder (relative to Mortgage Lenders/)")
    parser.add_argument("--skip-vectorize", action="store_true", help="Skip Vectorize embedding generation")
    args = parser.parse_args()

    print("=" * 60)
    print("LENDER DOCUMENT INGESTION PIPELINE")
    print("=" * 60)

    # ── Walk files ──
    all_files = walk_files(args.folder)
    if not all_files:
        print("  No files found.")
        return

    # Incremental: skip already-ingested
    if args.incremental:
        ingested = get_ingested_paths()
        before = len(all_files)
        all_files = [f for f in all_files if f["source_path"] not in ingested]
        print(f"  Incremental: {before} total, {len(all_files)} new, {before - len(all_files)} already ingested")
    else:
        print(f"  Found {len(all_files)} files")

    # Apply limit
    if args.limit > 0:
        all_files = all_files[:args.limit]
    print(f"  Processing: {len(all_files)} files", flush=True)

    if args.dry_run:
        print("\n  DRY RUN — no mutations:\n")
        for f in all_files:
            clean_title = os.path.splitext(f["filename"])[0]
            clean_title = re.sub(r'_dl$', '', clean_title)
            ext_type, d1_type = classify_doc_type(clean_title)
            print(f"  [{f['category']}/{f['lender_name']}] {f['filename']}")
            print(f"    → title: {clean_title}")
            print(f"    → lender: {f['lender_name']}, doc_type: {d1_type} ({ext_type})")
        print(f"\n  Total: {len(all_files)} files (dry run — no DB changes)")
        return

    # ── Process files ──
    all_rows = []
    errors = []
    retry_list = []

    for i, f in enumerate(all_files):
        pct = f"  [{i+1}/{len(all_files)}]".ljust(12)
        sys.stdout.write(f"\r{pct} {f['lender_name']:30s} — {f['filename']:<50s}")
        sys.stdout.flush()

        try:
            rows = build_insert_rows(f)
            if not rows:
                errors.append(f)
                continue
            all_rows.extend(rows)
        except Exception as e:
            errors.append(f)
            retry_list.append(f["source_path"])
            continue

    print(f"\n\n  Extracted: {len(all_rows)} rows from {len(all_files) - len(errors)} files")
    if errors:
        print(f"  Failed: {len(errors)} files")

    if not all_rows:
        print("  No rows to insert.")
        return

    # ── Batch INSERT to D1 (single-row inserts — multi-row VALUES fails with large content) ──
    print(f"\n  Inserting {len(all_rows)} rows to D1...", flush=True)
    inserted = 0
    batch_failures = []

    for row_idx, row in enumerate(all_rows):
        sql = (
            "INSERT INTO lender_docs(id, lender_name, doc_type, title, markdown_content, word_count, source_path) "
            f"VALUES ('{escape_sql(row['id'])}', '{escape_sql(row['lender_name'])}', "
            f"'{escape_sql(row['doc_type'])}', '{escape_sql(row['title'])}', "
            f"'{escape_sql(row['markdown_content'])}', {row['word_count']}, "
            f"'{escape_sql(row['source_path'])}');"
        )

        try:
            ok = d1_execute(sql)
            if ok:
                inserted += 1
            else:
                batch_failures.append(row_idx)
                print(f"\n  ⚠ Row {row_idx} failed: {row['title'][:50]}", flush=True)
            if (row_idx + 1) % 10 == 0 or row_idx == len(all_rows) - 1:
                sys.stdout.write(f"\r  Inserted: {inserted}/{len(all_rows)} rows")
                sys.stdout.flush()
        except Exception as e:
            batch_failures.append(row_idx)
            print(f"\n  ⚠ Row {row_idx} exception: {e}", flush=True)

    print(f"\n  Total inserted: {inserted}/{len(all_rows)}")

    # ── Rebuild FTS5 ──
    print("\n  Rebuilding FTS5 index...", flush=True)
    try:
        if d1_execute("INSERT INTO lender_docs_fts(lender_docs_fts) VALUES('rebuild');"):
            print("  ✅ FTS5 index rebuilt")
        else:
            print("  ⚠ FTS5 rebuild failed")
    except Exception as e:
        print(f"  ⚠ FTS5 rebuild failed: {e}")

    # ── Vectorize backfill ──
    if not args.skip_vectorize and os.environ.get("CLOUDFLARE_API_TOKEN"):
        print(f"\n  Generating Vectorize embeddings...", flush=True)
        try:
            r = subprocess.run(
                ["/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
                 f"{SCRIPT_DIR}/scripts/vectorize-backfill.py"],
                capture_output=True, text=True, timeout=600,
                env={**os.environ}
            )
            print(r.stdout[-500:] if r.stdout else r.stderr[-500:], flush=True)
        except Exception as e:
            print(f"  ⚠ Vectorize backfill failed: {e}")
    elif not args.skip_vectorize:
        print("  ⚠ CLOUDFLARE_API_TOKEN not set — skipping Vectorize")

    # ── Summary ──
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Files processed: {len(all_files)}")
    print(f"  Rows inserted:   {inserted}")
    print(f"  Extraction fails: {len(errors)}")
    if batch_failures:
        print(f"  Batch failures:   {len(batch_failures)} batches at offsets {batch_failures}")
    if retry_list:
        print(f"  Retry files:      {len(retry_list)}")
        for p in retry_list[:5]:
            print(f"    - {p}")
    print("=" * 60)


if __name__ == "__main__":
    run()
