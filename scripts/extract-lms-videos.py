#!/usr/bin/env python3
"""
LMS Video Extraction Pipeline — Purple CFS

Usage:
  python3 extract.py <seed-url> [--cookies <path>] [--output <dir>] [--dry-run]
                     [--d1-api <url>] [--admin-token <token>]

Requires: yt-dlp, playwright (chromium), webvtt-py
"""

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

DEFAULT_OUTPUT = Path.home() / "lms-extract"
DEFAULT_COOKIES = Path.home() / "purple-cfs-cookies.txt"
VIMEO_RE = re.compile(
    r'https://player\.vimeo\.com/video/(\d+)(?:\?h=([a-f0-9]+))?'
)

# ── Logging ──────────────────────────────────────────────────────────────────

def log(msg: str, level: str = "INFO"):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}")

def warn(msg: str):
    log(msg, "WARN")

def error(msg: str):
    log(msg, "ERROR")

# ─── Step 1: Target Discovery ───────────────

def discover_vimeo_iframes(seed_url: str, cookies_path: Path) -> list[dict]:
    """
    Use Playwright to load the LMS page with cookies,
    extract all Vimeo iframe URLs.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    targets = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            storage_state=None,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
        )

        # Import cookies
        if cookies_path.exists():
            with open(cookies_path) as f:
                cookiejar = []
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split("\t")
                    if len(parts) >= 7:
                        cookiejar.append({
                            "name": parts[5],
                            "value": parts[6],
                            "domain": parts[0],
                            "path": parts[2],
                            "httpOnly": parts[3] == "TRUE",
                            "secure": parts[4] == "TRUE",
                        })
            context.add_cookies(cookiejar)
            log(f"Loaded {len(cookiejar)} cookies from {cookies_path}")
        else:
            warn(f"Cookies file not found: {cookies_path}")

        page = context.new_page()
        try:
            log(f"Navigating to {seed_url}...")
            page.goto(seed_url, wait_until="networkidle", timeout=30000)
            # Extra wait for dynamic React/Vue content
            page.wait_for_timeout(3000)
        except PWTimeout:
            warn("Page load timeout — continuing with partial DOM")

        # Wait a bit more for dynamic iframes
        try:
            page.wait_for_selector("iframe[src*='player.vimeo.com']", timeout=10000)
        except PWTimeout:
            pass  # No iframes found via selector — scan all iframes

        # Scan all iframes
        iframes = page.query_selector_all("iframe")
        for frame in iframes:
            src = frame.get_attribute("src")
            if src and "player.vimeo.com" in src:
                match = VIMEO_RE.search(src)
                if match:
                    video_id = match.group(1)
                    hash_param = match.group(2)
                    target_url = (
                        f"https://player.vimeo.com/video/{video_id}" +
                        (f"?h={hash_param}" if hash_param else "")
                    )
                    if not hash_param:
                        warn(f"Video {video_id} missing ?h= privacy hash")
                    targets.append({
                        "url": target_url,
                        "video_id": video_id,
                        "hash": hash_param,
                        "referer": seed_url,
                        "page_title": page.title(),
                    })
                    log(f"  Found Vimeo: {target_url}")
                else:
                    warn(f"Could not parse Vimeo URL: {src}")

        browser.close()

    return targets


# ── Step 2: Approval Gate ───────────────────────────────────────────────────

def approval_gate(targets: list[dict], dry_run: bool, auto_approve: bool):
    """Policy-based approval before external network calls."""
    if dry_run:
        log("DRY RUN — no downloads will be performed")
        return True

    if auto_approve:
        log("Auto-approval enabled — skipping interactive gate")
        return True

    print()
    print("=" * 60)
    print("  APPROVAL GATE — External yt-dlp download pending")
    print("=" * 60)
    print(f"  Targets: {len(targets)} Vimeo video(s)")
    for t in targets:
        print(f"    • {t['url']}")
        print(f"      Referer: {t['referer']}")
    print()
    resp = input("  Proceed with yt-dlp downloads? [y/N]: ").strip().lower()
    print()
    return resp in ("y", "yes")


# ── Step 3: Asset Extraction (yt-dlp) ────────────────────────────────────────

def download_video(target: dict, output_dir: Path, cookies_path: Path) -> dict:
    """Download a single video + subtitles via yt-dlp."""
    video_dir = output_dir / "videos" / target.get("page_title", "untitled").replace("/", "-")
    video_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "yt-dlp",
        "--cookies", str(cookies_path),
        "--referer", target["referer"],
        "--write-sub",
        "--write-auto-sub",
        "--sub-lang", "en",
        "--output", str(video_dir / "%(title)s.%(ext)s"),
        "--no-overwrites",
        "--restrict-filenames",
        target["url"],
    ]

    log(f"  yt-dlp: {target['url']}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        error(f"  yt-dlp failed: {result.stderr.strip()}")
        return {"success": False, "error": result.stderr.strip()}

    # Find downloaded files
    files = list(video_dir.iterdir())
    video_file = next((f for f in files if f.suffix in (".mp4", ".mkv", ".webm")), None)
    vtt_file = next((f for f in files if f.suffix == ".vtt"), None)

    # Get duration from yt-dlp output
    duration = 0
    for line in result.stderr.splitlines():
        m = re.search(r'(\d+):(\d+):(\d+)', line)
        if m:
            h, m, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
            duration = h * 3600 + m * 60 + s
            break

    return {
        "success": True,
        "video_file": str(video_file) if video_file else None,
        "vtt_file": str(vtt_file) if vtt_file else None,
        "duration_seconds": duration,
        "title": video_file.stem if video_file else target.get("page_title", "untitled"),
    }


# ── Step 4: VTT Sanitization ────────────────────────────────────────────────

def sanitize_vtt(vtt_path: Path, title: str = "") -> str:
    """Convert VTT to clean markdown."""
    import webvtt

    lines = []
    seen = set()

    # Add heading
    if title:
        lines.append(f"# {title}")
        lines.append("")

    try:
        for caption in webvtt.read(str(vtt_path)):
            text = caption.text.strip()
            # Strip HTML tags
            text = re.sub(r'<[^>]+>', '', text)
            # Collapse whitespace
            text = re.sub(r'\s+', ' ', text)
            # Skip empty
            if not text:
                continue
            # Deduplicate sequential duplicates
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            lines.append(text)
    except Exception as e:
        warn(f"VTT parse error: {e}")
        # Fallback: raw text extraction
        raw = vtt_path.read_text(encoding="utf-8")
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("WEBVTT") or " --> " in line:
                continue
            line = re.sub(r'<[^>]+>', '', line)
            if line:
                lines.append(line)

    return "\n\n".join(lines)


# ── Step 5: D1 Ingestion ────────────────────────────────────────────────────

def ingest_to_d1(video_data: dict, markdown_content: str,
                 d1_api_url: str | None, admin_token: str | None) -> str | None:
    """Insert video + transcript into EdgeGDE D1 via Worker API."""
    if not d1_api_url or not admin_token:
        log("No D1 API configured — skipping ingestion (output saved locally)")
        return None

    video_id = str(uuid.uuid4())
    transcript_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # We insert directly via a custom endpoint on the worker.
    # For now, generate the SQL and log it for manual review.
    payload = {
        "video_id": video_id,
        "transcript_id": transcript_id,
        "video": {
            "id": video_id,
            "source_url": video_data.get("referer", ""),
            "vimeo_url": video_data.get("url", ""),
            "title": video_data.get("title", ""),
            "duration_seconds": video_data.get("duration_seconds", 0),
            "r2_key": None,
            "transcript_id": transcript_id,
        },
        "transcript": {
            "id": transcript_id,
            "video_id": video_id,
            "title": video_data.get("title", ""),
            "source_url": video_data.get("referer", ""),
            "markdown_content": markdown_content,
            "word_count": len(markdown_content.split()),
        },
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    }

    import urllib.request
    import urllib.error

    req = urllib.request.Request(
        f"{d1_api_url.rstrip('/')}/api/v1/kb/ingest",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            if result.get("ok"):
                log(f"  ✓ Ingested: {video_data.get('title', '')} ({video_id})")
                return video_id
            else:
                error(f"  Ingestion failed: {result}")
                return None
    except urllib.error.HTTPError as e:
        error(f"  HTTP {e.code}: {e.read().decode()}")
        return None
    except Exception as e:
        error(f"  Network error: {e}")
        return None


# ── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="LMS Video Extraction Pipeline")
    parser.add_argument("seed_url", help="LMS lesson page URL")
    parser.add_argument("--cookies", default=str(DEFAULT_COOKIES), help="Path to cookies.txt")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output directory")
    parser.add_argument("--dry-run", action="store_true", help="Discover only, no downloads")
    parser.add_argument("--no-approve", action="store_true", help="Skip approval gate")
    parser.add_argument("--d1-api", help="EdgeGDE Worker API base URL (for D1 ingestion)")
    parser.add_argument("--admin-token", help="Admin bearer token for D1 API")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    cookies_path = Path(args.cookies)

    log("=" * 60)
    log("LMS Video Extraction Pipeline")
    log("=" * 60)
    log(f"Seed URL: {args.seed_url}")
    log(f"Output:   {output_dir}")
    log(f"Cookies:  {cookies_path}")
    log()

    # ── Step 1: Target Discovery ──
    log("Step 1/4: Discovering Vimeo iframes...")
    targets = discover_vimeo_iframes(args.seed_url, cookies_path)

    if not targets:
        log("No Vimeo iframes found on this page.", "WARN")
        log("Step 1.5: Checking for dynamic rendering...")
        warn("No media found after DOM scan.")
        sys.exit(0)

    log(f"Found {len(targets)} Vimeo target(s)")
    log()

    # Save target manifest
    manifest_path = output_dir / "logs" / f"targets_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(targets, indent=2))
    log(f"Target manifest: {manifest_path}")
    log()

    # ── Step 2: Approval Gate ──
    if not approval_gate(targets, args.dry_run, args.no_approve):
        log("Download cancelled by user.")
        sys.exit(0)

    # ── Step 3: Asset Extraction ──
    log(f"{'Step 2/4: DRY RUN — Targets logged' if args.dry_run else 'Step 2/4: Downloading videos...'}")
    for i, target in enumerate(targets, 1):
        log(f"[{i}/{len(targets)}] Processing: {target['url']}")

        if args.dry_run:
            log(f"  Would download to: {output_dir / 'videos' / target.get('page_title', 'untitled')}")
            continue

        result = download_video(target, output_dir, cookies_path)

        if not result["success"]:
            log(f"  ✗ Download failed: {result.get('error', 'unknown')}", "ERROR")
            continue

        log(f"  ✓ Video: {result.get('video_file', 'N/A')}")
        log(f"  ✓ VTT:   {result.get('vtt_file', 'N/A')}")

        # ── Step 4: VTT Sanitization ──
        if result.get("vtt_file"):
            log("  Step 3/4: Sanitizing VTT to markdown...")
            vtt_path = Path(result["vtt_file"])
            markdown = sanitize_vtt(vtt_path, title=result.get("title", ""))

            md_path = vtt_path.with_suffix(".md")
            md_path.write_text(markdown, encoding="utf-8")
            log(f"  ✓ Markdown: {md_path}")

            word_count = len(markdown.split())
            log(f"  Word count: {word_count}")
        else:
            log("  No transcript available — skipping text pipeline", "WARN")
            markdown = ""

        # ── Step 5: D1 Ingestion ──
        if markdown:
            log("  Step 4/4: Ingesting into knowledge base...")
            ingest_to_d1(
                {**target, **result},
                markdown,
                args.d1_api,
                args.admin_token,
            )

        log()

    log("Pipeline complete.")
    log(f"All output: {output_dir}")


if __name__ == "__main__":
    main()
