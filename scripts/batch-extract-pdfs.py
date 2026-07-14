#!/usr/bin/env python3
"""Batch extract all new PDFs and save as markdown."""
import pdfplumber, os, sys

DIR = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/AFIRMICO Documents DB/AFIRMICO - PCFS - LMS Data/videos/compliance-induction"

PDFS = [
    ("Advertising-and-Marketing-Guidelines-v1.1.pdf", "Advertising and Marketing Guidelines v1.1"),
    ("Application-Supporting-Documentation-File-Audit-Guide-v5_Jan_2026.pdf", "Application Supporting Documentation File Audit Guide v5"),
    ("Best-Interests-Duty-The-Conflict-Rule-Policy-May-2026-V2.pdf", "Best Interests Duty & The Conflict Rule Policy v2"),
    ("Complaints-and-Disputes-Policy.pdf", "Complaints and Disputes Policy"),
    ("CPD_Policy_Mortgage_Brokers.pdf", "CPD Policy - Mortgage Brokers"),
    ("PCFS-Compliance-Program-2.0_Jan-2026.pdf", "PCFS Compliance Program 2.0"),
    ("SMSF-FAQ.pdf", "SMSF FAQ"),
    ("Website-Guidelines.pdf", "Website Guidelines"),
]

for pdf_name, title in PDFS:
    pdf_path = os.path.join(DIR, pdf_name)
    if not os.path.exists(pdf_path):
        print(f"MISSING: {pdf_name}")
        continue
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    except Exception as e:
        print(f"ERROR extracting {pdf_name}: {e}")
        continue
    
    md_name = pdf_name.replace(".pdf", ".md")
    md_path = os.path.join(DIR, md_name)
    with open(md_path, "w") as f:
        f.write(f"# {title}\n\nSource: Purple Circle Financial Services\n\n{text}")
    
    wc = len(text.split())
    cc = len(text)
    print(f"OK  {pdf_name}: {wc:5d} words, {cc:6d} chars → {md_name}")

print("\nAll done.")
