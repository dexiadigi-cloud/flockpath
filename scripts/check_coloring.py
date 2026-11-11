"""Coloring QA gate for Flockpath, Nov 1, 2026.

A render passes only if it is a real coloring page, not a
shaded illustration: high resolution for Letter print,
mostly near-black or near-white pixels, and very few gray
pixels in between. Gray is the tell for shading, which a
child cannot color cleanly and which prints muddy.

This script does NOT check by eye, and it cannot detect
text in the image or a wrong scene. Those are the human
QA steps in COLORING-10.md, and they still apply. A PASS
here means "worth a human look", not "ship it".

Usage: .venv/bin/python scripts/check_coloring.py <file.png>
Exit 0 on PASS, 1 on FAIL, with the numbers printed either
way, so a fail is diagnosable, not a mystery.

Thresholds, chosen for a black-outline page at print size:
- width at least 2250 px (7.5 in at 300 dpi)
- gray share (pixels with all channels between 40 and 215,
  i.e. neither near-black nor near-white) at most 5%
- black share at least 1% (a blank white page must fail)
- no alpha channel hiding a background: if the image has
  alpha, fully transparent pixels count as a fail, because
  Typst prints the page on white and a transparent render
  is not the same as a white-background render.
"""
import sys
from pathlib import Path

MIN_WIDTH = 2250
MAX_GRAY_SHARE = 0.05
MIN_BLACK_SHARE = 0.01


def main():
    if len(sys.argv) != 2:
        print("usage: check_coloring.py <file.png>")
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"FAIL: file not found: {path}")
        return 1
    try:
        from PIL import Image
    except ImportError:
        print("FAIL: Pillow is not installed in this Python.")
        return 1
    try:
        img = Image.open(path)
    except Exception as e:
        print(f"FAIL: could not open image: {e}")
        return 1
    width, height = img.size
    print(f"file: {path.name}  size: {width}x{height}  mode: {img.mode}")
    failures = []
    if width < MIN_WIDTH:
        failures.append(f"width {width} is under {MIN_WIDTH} px for Letter print")
    if img.mode in ("RGBA", "LA", "PA"):
        alpha = img.convert("RGBA").getchannel("A")
        transparent = sum(1 for v in alpha.tobytes() if v == 0)
        total = width * height
        if transparent:
            failures.append(f"{transparent} fully transparent pixels ({transparent / total:.1%}); render on a white background, not transparent")
    gray_img = img.convert("L")
    pixels = list(gray_img.tobytes())
    total = len(pixels)
    gray = sum(1 for v in pixels if 40 <= v <= 215)
    black = sum(1 for v in pixels if v < 40)
    gray_share = gray / total if total else 1
    black_share = black / total if total else 0
    print(f"black: {black_share:.2%}  gray: {gray_share:.2%}  white: {1 - black_share - gray_share:.2%}")
    if gray_share > MAX_GRAY_SHARE:
        failures.append(f"gray share {gray_share:.2%} is over {MAX_GRAY_SHARE:.0%}; this looks shaded, not outline-only")
    if black_share < MIN_BLACK_SHARE:
        failures.append(f"black share {black_share:.2%} is under {MIN_BLACK_SHARE:.0%}; this looks blank")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("PASS: outline QA numbers pass. Human eye check (text, scene, simplicity) still required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
