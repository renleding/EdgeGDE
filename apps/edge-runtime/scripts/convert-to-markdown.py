#!/usr/bin/env python3
"""
EdgeGDE — Convert office/PDF documents to Markdown (anydoc engine).

Default converter for the KB ingestion lane (knowledge-base-ingestion skill).
Handles Word (.doc/.docx/.docm), PowerPoint, Excel, OpenDocument, RTF, EPUB,
CSV and text-based PDF → clean GitHub-Flavored Markdown. Pure local (Rust),
no network, no ML, ~sub-ms to ~350ms per document.

OCR GAP: scanned/image-only PDFs return UnsupportedError — anydoc has no OCR.
Those route to the Apple Vision OCR lane (doc-intel poller) or the Issuu
extraction lane, NOT this converter.

Usage:
  # Convert one or more files (writes <stem>.md next to each input)
  python3 convert-to-markdown.py file.pdf file.docx slides.ppt

  # Convert a whole folder into an output directory
  python3 convert-to-markdown.py --dir "Broker Info/PCFS - Process and Info" --out /tmp/kb-md

  # Machine-readable summary on stdout; exit 0 = all ok, 2 = all failed

Setup (PEP 668 macOS — uv venv):
  uv venv --python /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 ~/.venvs/kb
  source ~/.venvs/kb/bin/activate
  uv pip install firecrawl-anydoc==0.1.7
"""
import argparse, os, sys, time

try:
    import anydoc
except ImportError:
    sys.stderr.write(
        "anydoc not installed. Set up the KB venv first:\n"
        "  uv venv --python /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 ~/.venvs/kb\n"
        "  source ~/.venvs/kb/bin/activate\n"
        "  uv pip install firecrawl-anydoc==0.1.7\n"
    )
    sys.exit(3)

def convert(path: str, out_dir: str | None) -> tuple[str, str, float, int, str]:
    """Return (status, detail, ms, words, out_path)."""
    t0 = time.perf_counter()
    try:
        md = anydoc.to_markdown(path)
        dt = (time.perf_counter() - t0) * 1000
        words = len(md.split())
        out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".md") if out_dir \
            else os.path.splitext(path)[0] + ".md"
        with open(out, "w", encoding="utf-8") as f:
            f.write(md)
        return "OK", "", dt, words, out
    except anydoc.UnsupportedError as e:
        dt = (time.perf_counter() - t0) * 1000
        return "SCANNED/UNSUPPORTED", str(e), dt, 0, ""  # OCR gap — route to Apple Vision/Issuu lane
    except anydoc.ConvertError as e:
        dt = (time.perf_counter() - t0) * 1000
        return "CONVERT_FAIL", f"{type(e).__name__}: {e}", dt, 0, ""

def main():
    ap = argparse.ArgumentParser(description="Convert documents to Markdown (anydoc).")
    ap.add_argument("files", nargs="*", help="files to convert")
    ap.add_argument("--dir", help="convert every supported file in this directory")
    ap.add_argument("--out", help="output directory for .md files (default: next to input)")
    args = ap.parse_args()

    if not args.files and not args.dir:
        ap.error("give files or --dir")

    out_dir = args.out
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    targets: list[str] = list(args.files)
    if args.dir:
        for root, _, files in os.walk(args.dir):
            for fn in files:
                targets.append(os.path.join(root, fn))

    if not targets:
        print("no files found"); sys.exit(2)

    ok = scanned = failed = 0
    for p in targets:
        status, detail, dt, words, out = convert(p, out_dir)
        if status == "OK":
            ok += 1
            print(f"OK       {dt:7.1f}ms  words={words:6d}  {out}")
        elif status == "SCANNED/UNSUPPORTED":
            scanned += 1
            print(f"SCANNED  {dt:7.1f}ms  {p}  <- no OCR; route to Apple Vision/Issuu lane ({detail})")
        else:
            failed += 1
            print(f"FAIL     {dt:7.1f}ms  {p}  <- {detail}")

    print(f"\n{ok} converted, {scanned} scanned/unsupported, {failed} failed")
    sys.exit(0 if ok and not failed else (2 if failed and not ok else 0))

if __name__ == "__main__":
    main()
