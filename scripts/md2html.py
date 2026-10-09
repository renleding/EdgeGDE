#!/usr/bin/env python3
"""Convert EdgeGDE spec/docs markdown to standalone HTML.

Usage:
  python3 scripts/md2html.py docs/FRS-010-*.md        # single file -> docs/html/
  python3 scripts/md2html.py --all docs/               # every .md in dir
  python3 scripts/md2html.py --all docs/ --watch        # rebuild on change (optional)

Design:
  - Source of truth REMAINS markdown (git diffs, ste-lint, token economy, PR review).
  - HTML is a build artifact under docs/html/ (gitignored by default; publish on demand).
  - Uses pandoc (already installed at /usr/local/bin/pandoc) with a shared template
    so every spec gets identical styling, TOC, and metadata header.
  - Preserves requirement tables and fenced AC code blocks as-is.

Exit codes: 0 ok, 1 pandoc failure, 2 bad args.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PANDOC = "/usr/local/bin/pandoc"
OUT_DIR = REPO_ROOT / "docs" / "html"
TEMPLATE = REPO_ROOT / "docs" / "html" / "template.html"

# Metadata block conventions (FRS/SDD/IDD header): **Document ID:** X, **Version:** Y, etc.
META_RE = re.compile(r"\*\*(Document ID|Version|Status|Author|Date|Source):\*\*\s*(.+)")


def extract_meta(md_text: str) -> dict[str, str]:
    return {m.group(1): m.group(2).strip() for m in META_RE.finditer(md_text)}


def convert_one(src: Path, out_dir: Path, css_href: str = "style.css") -> Path:
    src = src.resolve()
    text = src.read_text(encoding="utf-8")
    meta = extract_meta(text)

    title = src.stem
    if meta.get("Document ID") and meta.get("Version"):
        title = f"{meta['Document ID']} — {src.stem.split('-', 3)[-1] if '-' in src.stem else src.stem}"

    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / (src.stem + ".html")

    cmd = [
        PANDOC, str(src),
        "--from", "gfm",
        "--to", "html5",
        "--standalone",
        "--toc", "--toc-depth=3",
        "--metadata", f"title={title}",
        "--css", css_href,
        "--output", str(dest),
    ]
    if TEMPLATE.exists():
        cmd += ["--template", str(TEMPLATE)]
    # Metadata header line for spec docs
    if meta:
        meta_html = "".join(
            f'<div class="meta-row"><span class="meta-k">{k}:</span> <span class="meta-v">{v}</span></div>'
            for k, v in meta.items()
        )
        cmd += ["--metadata", f"metaheader={meta_html}"]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"FAIL {src.name}: {proc.stderr.strip()}", file=sys.stderr)
        return dest  # non-zero handled by caller
    print(f"  ok  {src.relative_to(REPO_ROOT)} -> {dest.relative_to(REPO_ROOT)}")
    return dest


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", help="markdown files or directories")
    ap.add_argument("--all", action="store_true", help="convert every .md under each given directory")
    ap.add_argument("--out", default=str(OUT_DIR), help="output directory (default docs/html)")
    args = ap.parse_args(argv)

    if not args.paths:
        ap.print_usage()
        return 2

    files: list[Path] = []
    for p in args.paths:
        path = Path(p)
        if path.is_dir():
            if args.all:
                files.extend(sorted(path.rglob("*.md")))
            else:
                files.extend(sorted(path.glob("*.md")))
        elif path.is_file():
            files.append(path)
        else:
            print(f"not found: {p}", file=sys.stderr)
            return 2

    if not files:
        print("no markdown files matched", file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = (REPO_ROOT / out_dir).resolve()
    failures = 0
    for f in files:
        dest = convert_one(f, out_dir)
        # detect failure via empty/missing file
        if not dest.exists() or dest.stat().st_size == 0:
            failures += 1

    # shared stylesheet (first run only)
    css = out_dir / "style.css"
    if not css.exists():
        css.write_text(SHEET, encoding="utf-8")

    print(f"\n{len(files) - failures}/{len(files)} converted -> {out_dir}/")
    return 1 if failures else 0


SHEET = """\
:root{--ink:#1a1d21;--mut:#5b6470;--line:#e3e6ea;--acc:#0b57d0;--bg:#fff;--code:#f4f6f8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.page{max-width:60rem;margin:0 auto;padding:2.5rem 1.5rem 5rem}
header.doc-title{border-bottom:2px solid var(--line);padding-bottom:1rem;margin-bottom:1.5rem}
header.doc-title h1{margin:0 0 .75rem;font-size:1.9rem;line-height:1.25}
.meta-block{background:var(--code);border:1px solid var(--line);border-radius:8px;
 padding:.6rem .9rem;font-size:.86rem;margin-top:.75rem}
.meta-row{display:flex;gap:.5rem;padding:.1rem 0}
.meta-k{color:var(--mut);font-weight:600;min-width:6.5rem}
.meta-v{color:var(--ink)}
nav#TOC{background:var(--code);border:1px solid var(--line);border-radius:8px;
 padding:.9rem 1.2rem;margin:1.5rem 0 2rem;font-size:.92rem}
nav#TOC ul{list-style:none;margin:.25rem 0;padding-left:1rem}
nav#TOC>ul{padding-left:0}
nav#TOC a{color:var(--acc);text-decoration:none}
nav#TOC a:hover{text-decoration:underline}
h2{margin-top:2.4rem;padding-top:.6rem;border-top:1px solid var(--line)}
h3,h4{margin-top:1.7rem}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.93rem}
th,td{border:1px solid var(--line);padding:.5rem .7rem;text-align:left;vertical-align:top}
th{background:var(--code);font-weight:600}
tr:nth-child(even) td{background:#fafbfc}
code{background:var(--code);padding:.12rem .35rem;border-radius:4px;
 font:.9em ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;
 padding:.9rem 1.1rem;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{border-left:4px solid var(--acc);margin:1rem 0;padding:.2rem 0 .2rem 1rem;color:var(--mut)}
a{color:var(--acc)}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);
 color:var(--mut);font-size:.82rem}
"""

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))