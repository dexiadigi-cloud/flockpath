"""
FLOCKPATH COLORING ART ONLY

Forked 2026-10-31 from Dexia's generate_coloring_art.py, with a
different job, a different style, and no Dexia dependencies.

Differences from the Dexia script, by design:
- Flockpath style, not Dexia house style. The template below is the
  Flockpath template from COLORING-10.md: simple closed shapes for
  ages 6-10, one main scene, no border frame, no text, no detailed
  faces or hands as the main subject, no depiction of Jesus in v1.
  The script owns the style tail; the caller passes only the scene
  via --subject, never the full prompt.
- Portrait default. Default size is 1024x1328 (Letter portrait
  ratio), not 1024x1024. --width and --height still override it.
- Standalone. No art_slots import, no Dexia pipeline dependency.
  Output checking is local: the file must be a valid PNG with
  positive dimensions. Print QA (width >= 2250 px, gray share,
  black share) lives in the Flockpath tool's check_coloring.py
  and is run on receipt, not in this render script.
- Same safety rules as Dexia: txt2img only, fresh canvas assert,
  pinned Z-Image-Turbo base model only, no LoRA, no init image,
  no mask, no img2img, seed logged to a .seed.json sidecar.

License: MIT, same as the Flockpath tool. Model: Z-Image-Turbo,
Apache 2.0, commercial use OK.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

DEFAULT_URL = "http://127.0.0.1:7860/sdapi/v1/txt2img"

MODEL_ID = "z_image_turbo_1.0_i8x.ckpt"
REQUIRED_MODEL = "z_image_turbo_1.0_i8x.ckpt"
SEED_MAX = 2 ** 32 - 1

# Flockpath defaults: portrait Letter ratio. Override with
# --width / --height when a different size is needed.
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1328

# Flockpath template (hardcoded, foolproof). Scene is switched
# via --subject. The style tail is owned by this script, never
# typed by the caller, so every Flockpath coloring page shares
# the same style.
FLOCKPATH_TEMPLATE = (
    "black outline coloring page for children ages 6-10, "
    "thick clean black outlines on a pure white background, "
    "no shading, no gray, no color, no words or letters anywhere, "
    "simple closed shapes a child can color, one main scene, "
    "no border frame, no detailed faces or hands as the main subject, "
    "tall vertical full page portrait composition. {subject}. "
    "unpainted line art."
)


def assert_fresh_canvas(payload):
    """Reject any payload that could carry state from a previous render."""
    forbidden = ['init_images', 'mask', 'inpainting_fill', 'denoising_strength']
    for key in forbidden:
        if key in payload and payload[key]:
            raise ValueError(f"FRESH CANVAS VIOLATION: payload contains '{key}'. Every render must be stateless txt2img only. No init images, no masks, no img2img.")


def assert_correct_model(payload):
    """Reject any payload not pinned to the required base model."""
    if payload.get("model") != REQUIRED_MODEL:
        raise ValueError(
            f"MODEL VIOLATION: payload model is {payload.get('model')!r}, "
            f"required {REQUIRED_MODEL!r}. Only the base Z-Image-Turbo model "
            "may be used — no LoRA, no fallback, no override.")


def resolve_seed(seed: int | None = None) -> int:
    """Return `seed` if given, else a random seed per run."""
    if seed is not None:
        return int(seed)
    return random.randint(0, SEED_MAX)


def write_seed_sidecar(output_path: str | Path, *, seed: int, prompt: str,
                        model: str = MODEL_ID, steps: int = 8,
                        cfg: float = 1.0,
                        sampler: str = "DPM++ 2M AYS") -> Path:
    """Write a JSON sidecar next to the output image logging the seed used.

    Example: output `art/foo.png` -> sidecar `art/foo.seed.json`.
    """
    out = Path(output_path)
    sidecar = out.with_suffix(".seed.json")
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "seed": int(seed),
        "prompt": prompt,
        "model": model,
        "steps": steps,
        "cfg": cfg,
        "sampler": sampler,
        "width": None,
        "height": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    sidecar.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return sidecar


def output_ok(output_path: str | Path):
    """Local Flockpath output check, no Dexia dependency.

    Returns (True, reason) when the file is a valid PNG with
    positive dimensions, else (False, reason). Exact native size
    is not failed here: Draw Things may round a requested size,
    and the Flockpath tool's check_coloring.py gates print size
    on receipt. A size mismatch is printed as a warning by the
    caller, not a failure.
    """
    out = Path(output_path)
    if not out.exists():
        return False, "output file does not exist"
    if out.stat().st_size == 0:
        return False, "output file is empty"
    try:
        with Image.open(out) as img:
            img.verify()
        with Image.open(out) as img:
            if img.width < 1 or img.height < 1:
                return False, "image has no dimensions"
    except Exception as e:  # noqa: BLE001 - any bad PNG is a failure
        return False, f"not a valid PNG: {e}"
    return True, "ok"


def generate_clean_coloring_page(subject_prompt, output_path, *,
                                    url=DEFAULT_URL, negative='',
                                    width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                                    steps=8, cfg=1.0, seed: int | None = None,
                                    full_prompt: bool = False,
                                    sampler: str = "DPM++ 2M AYS") -> Path:
    """Request a coloring page from Draw Things and save a PNG.

    Always uses an empty canvas (pure text-to-image). Raises
    RuntimeError on HTTP/API errors.
    Pass full_prompt=True when subject_prompt is already a complete
    locked template (the Flockpath template, as built in main()).
    Default: random seed per run (logged to .seed.json). Pass
    seed=N to reproduce a specific image.
    """
    seed = resolve_seed(seed)
    if "transparent background" in subject_prompt.lower():
        raise ValueError(
            "Refusing prompt with 'transparent background': Draw Things "
            "ignores it. Render on a pure white background, txt2img only.")
    body = {
        "model": MODEL_ID,
        "prompt": subject_prompt,
        "width": width,
        "height": height,
        "steps": steps,
        "cfg_scale": cfg,
        "sampler": sampler,
        "seed": seed,
    }
    assert_fresh_canvas(body)
    assert_correct_model(body)
    print("[canvas cleared: verified - stateless txt2img, no init_image/mask/denoise]", flush=True)
    print(f"  [sampler={sampler}] generating {Path(output_path).name} "
          f"({width}x{height}, seed {seed})", flush=True)
    req = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        server_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Draw Things HTTP {e.code}: {server_text}") from e
    except URLError as e:
        raise RuntimeError(
            f"Draw Things API unreachable: {e}. Is the app running with its "
            "HTTP API enabled on port 7860?"
        ) from e

    images = data.get("images") or []
    if not images:
        raise RuntimeError(
            "Draw Things returned no images: " + json.dumps(data)[:500]
        )
    raw = base64.b64decode(images[0])

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    _save_grayscale(raw, out)
    sidecar = write_seed_sidecar(out, seed=seed, prompt=body["prompt"],
                        model=body["model"], steps=steps, cfg=cfg,
                        sampler=sampler)
    # Record the requested size in the sidecar for QA on receipt.
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
        payload["width"] = int(width)
        payload["height"] = int(height)
        sidecar.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001 - sidecar size is informational only
        pass
    return out


def _save_grayscale(raw: bytes, out: Path) -> None:
    """Write raw PNG bytes, grayscale, unthresholded, to `out`."""
    img = Image.open(io.BytesIO(raw)).convert("L")
    img.save(out, format="PNG")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Generate a clean black-and-white Flockpath coloring "
        "page PNG. With --batch N, --out is treated as a base path and N "
        "variants are rendered (e.g. page01 -> page01a.png, page01b.png, ...). "
        f"Default size is portrait {DEFAULT_WIDTH}x{DEFAULT_HEIGHT}.")
    ap.add_argument("--subject", required=True,
                    help="scene description only, e.g. 'a shepherd with "
                    "three sheep on rolling hills'. The Flockpath style tail "
                    "is added by this script, do not include it.")
    ap.add_argument("--out", required=True, help="output PNG path")
    ap.add_argument("--seed", type=int, default=None,
                    help="Default: random seed (logged to .seed.json). "
                          "Use --seed N to reproduce a specific image. "
                          "With --batch, variants use seed N, N+1, ...")
    ap.add_argument("--batch", type=int, default=1,
                    help="Render N variants in one invocation. --out is "
                          "treated as a base path; outputs are <base>a.png, "
                          "<base>b.png, ... (max 26). Default: 1.")
    ap.add_argument("--grade", required=False, default=None,
                    help="not used in coloring art generation")
    ap.add_argument("--fresh", action="store_true",
                    help="not used in coloring art generation")
    ap.add_argument("--width", type=int, default=DEFAULT_WIDTH,
                    help=f"Render width in pixels. Default: {DEFAULT_WIDTH}.")
    ap.add_argument("--height", type=int, default=DEFAULT_HEIGHT,
                    help=f"Render height in pixels. Default: {DEFAULT_HEIGHT}.")

    args = ap.parse_args(argv)

    if not args.subject:
        print("ERROR: --subject is required", file=sys.stderr)
        return 1

    subject = FLOCKPATH_TEMPLATE.replace("{subject}", args.subject)

    width, height = args.width, args.height
    if width < 1 or height < 1:
        print("ERROR: --width and --height must be positive", file=sys.stderr)
        return 1

    batch = args.batch
    if batch < 1 or batch > 26:
        print("ERROR: --batch must be between 1 and 26", file=sys.stderr)
        return 1

    seed = resolve_seed(args.seed)
    if batch == 1:
        targets = [args.out]
        seeds = [seed]
    else:
        base = args.out
        if base.lower().endswith(".png"):
            base = base[:-4]
        targets = [f"{base}{chr(ord('a') + i)}.png" for i in range(batch)]
        seeds = [seed + i for i in range(batch)]

    for out_path, s in zip(targets, seeds):
        try:
            generate_clean_coloring_page(
                subject, out_path, url=DEFAULT_URL,
                width=width, height=height, steps=8,
                cfg=1.0, seed=s, full_prompt=True,
            )
        except RuntimeError as e:
            print(f"!! {e}", file=sys.stderr)
            return 1

        success, reason = output_ok(out_path)
        if not success:
            print(f"ERROR: Generated image {out_path} does not meet requirements: {reason}", file=sys.stderr)
            return 1

        try:
            with Image.open(out_path) as img:
                actual = (img.width, img.height)
            if actual != (width, height):
                print(f"WARNING: requested {width}x{height}, got {actual[0]}x{actual[1]} "
                      f"(print QA on receipt decides, not this check)", flush=True)
        except Exception:  # noqa: BLE001 - output_ok already passed
            pass

        print(f"saved -> {Path(out_path).resolve()} "
              f"({width}x{height} requested, 8 steps, cfg 1.0, seed {s})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
