"""PDF text extraction for Flockpath input, Nov 1, 2026.

A pastor's sermon is often a PDF, not a paste. This script
extracts its text with pypdf, page by page, so the normal
regex reference extraction can run on it exactly as it runs
on pasted text. It never invents refs, and it never sends
the file anywhere: it reads one local file and prints text.

Usage: .venv/bin/python scripts/extract_pdf.py <file.pdf>
Output: JSON {"pages": n, "text": "..."} on stdout.
Errors go to stderr with a non-zero exit, so the caller can
tell the pastor plainly that this PDF could not be read,
instead of silently generating from nothing.
"""
import json
import sys
from pathlib import Path

from pypdf import PdfReader


def main():
    if len(sys.argv) != 2:
        print("usage: extract_pdf.py <file.pdf>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 2
    try:
        reader = PdfReader(str(path))
    except Exception as e:
        print(f"Could not read this PDF: {e}", file=sys.stderr)
        return 1
    if reader.is_encrypted:
        print("This PDF is encrypted and cannot be read. Use an unencrypted copy.", file=sys.stderr)
        return 1
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    text = "\n".join(pages)
    if not text.strip():
        print("This PDF has no readable text. It may be a scanned image, which this version cannot read.", file=sys.stderr)
        return 1
    print(json.dumps({"pages": len(pages), "text": text}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
