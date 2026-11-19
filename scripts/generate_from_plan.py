"""Step 7.5 Phase D, step 3: generation from a confirmed plan.

Input is a confirmed plan JSON, the same shape the /input
confirm screen produces, plus angles and topics for the test:
  {
    "passage": "Romans 8",
    "refs": ["ROM 8:28", "ROM 8:31", "ROM 8:32", "ROM 8:37", "ROM 8:38"],
    "angles": ["God works for good", "God for us", "God gave his Son",
               "More than conquerors", "Nothing separates"],
    "topics": ["love", "assurance", "grace"]
  }

Angles and topics in this step are test input, supplied with
the plan, not invented by the model. A later step derives
angles from Phos lexicon/commentary when the pastor gives
only refs. What this script proves is the chain, not the
angle derivation:
  confirmed plan -> ingest stores -> Phos bundle ->
  section generation -> hymn match -> quality -> lock -> PDF

Steps that need a book not yet ingested are ingested here
from the BSB store builder, so a pastor is not limited to
GEN/PSA/JHN/EXO/ROM stores that happen to already exist.
Nov 1, 2026, BSB migration: WEB/engwebp is retired. All new
packs use BSB, from data/bsb-<CODE>.json, translation "bsb".

Usage:
  python3 scripts/generate_from_plan.py plan.json out-tag [--no-lock]
Output: data/<tag>-draft.json, data/locked-<tag>.json,
        output/pack-<tag>.pdf (9 pages, if the hymn fits)
With --no-lock, Nov 1, 2026, review-before-lock: the script
stops after hymn match, expands the draft with verse text
from the store, and writes data/<tag>-draft-expanded.json.
It does NOT lock. Locking is the pastor's act, on the review
page, after they have checked the draft.
"""
import json
import subprocess
import sys
import zipfile
from pathlib import Path

try:
    from progress import write_progress
except Exception:
    # Observability must never break generation: if the
    # progress helper cannot load, steps are simply not shown.
    def write_progress(*args, **kwargs):
        pass

ROOT = Path(__file__).resolve().parent.parent

def ingest_book(code, translation="bsb"):
    # BSB, Nov 1, 2026: all 66 books are prebuilt in
    # data/bsb-<CODE>.json by scripts/build_bsb_store.py from
    # the verified bsb.txt. If a book file is missing, rebuild
    # it, do not fall back to the retired WEB store.
    # Nov 11, 2026, v53: Spanish translations read their
    # own stores (data/rv1909-<CODE>.json, data/spabes-
    # <CODE>.json), built by scripts/build_spanish_stores.py
    # from the verified eBible USFM. RVR1960 is copyrighted
    # and is never a valid translation here.
    if translation not in ("bsb", "rv1909", "spabes"):
        raise SystemExit(f"Unknown translation: {translation}")
    store_path = ROOT / f"data/{translation}-{code}.json"
    if store_path.exists():
        return json.loads(store_path.read_text(encoding="utf-8"))
    if translation == "bsb":
        subprocess.run([sys.executable, "scripts/build_bsb_store.py"], cwd=ROOT, check=True)
    else:
        subprocess.run([sys.executable, "scripts/build_spanish_stores.py"], cwd=ROOT, check=True)
    if not store_path.exists():
        raise SystemExit(f"No {translation} store for {code}, even after rebuild")
    return json.loads(store_path.read_text(encoding="utf-8"))

def run(cmd):
    # Nov 5, 2026, v28 fix: a bare check=True raises a
    # CalledProcessError whose message is only the command,
    # so the pastor saw "Building stopped because:
    # subprocess.CalledProcessError: Command [...]" and never
    # the real reason underneath (e.g. "Reference not in
    # verse store"). Capture stderr and raise it instead, so
    # the failure reason the worker shows is the step's own
    # error. Stdout still streams live (inherited).
    print("+", " ".join(cmd))
    out = subprocess.run(cmd, cwd=ROOT, stderr=subprocess.PIPE, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-2000:] or f"command failed: {' '.join(cmd)}")

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print("usage: generate_from_plan.py <plan.json> <out-tag> [--no-lock] [--progress-file <path>]", file=sys.stderr)
        return 2
    plan = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    tag = args[1]
    rest = args[2:]
    no_lock = False
    progress_file = None
    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg == "--no-lock":
            no_lock = True
            i += 1
        elif arg == "--progress-file" and i + 1 < len(rest):
            progress_file = rest[i + 1]
            i += 2
        else:
            print(f"unknown argument: {arg}", file=sys.stderr)
            return 2
    refs = plan["refs"]
    # Nov 11, 2026, v54, Phase 4 flexible length: a plan
    # carries 3, 5, or 7 refs, one per day. Anything else is
    # a caller error, caught here before any model time.
    if len(refs) not in (3, 5, 7):
        raise SystemExit(f"Confirmed plan must have 3, 5, or 7 refs, got {len(refs)}")
    day_count = len(refs)
    # Nov 11, 2026, v53: the plan carries the language and
    # translation (validated by the /api/generate route).
    # Legacy plans have neither: English + BSB, as before.
    language = str(plan.get("language") or "en").strip().lower()
    if language not in ("en", "es"):
        raise SystemExit(f"Unknown language: {language}")
    translation = str(plan.get("translation") or "bsb").strip().lower()
    if translation not in ("bsb", "rv1909", "spabes"):
        raise SystemExit(f"Unknown translation: {translation}")
    if language == "en" and translation != "bsb":
        raise SystemExit(f"English packs use BSB, not {translation}")
    if language == "es" and translation == "bsb":
        raise SystemExit("Spanish packs need rv1909 or spabes, not bsb")
    # Nov 3, 2026, generation step display: the pastor sees
    # which step the pack is on, not just "running". Steps are
    # observability only: bundle, angles when derived, the
    # 2N+1 sections in day order (adult + kid per day, then
    # leader), hymn, finish. Totals: section_base + 2N + 3
    # (15 with derived angles, 14 without, for a 5-day pack).
    # The worker passes the progress file; without it, no
    # steps are written.
    deriving_angles = not plan.get("angles") or len(plan["angles"]) != day_count
    section_base = 2 if deriving_angles else 1
    progress_total = section_base + 2 * day_count + 3

    def report(step, label):
        if not progress_file:
            return
        try:
            write_progress(progress_file, step, progress_total, label)
        except Exception:
            pass

    report(1, "Gathering study material from Phos")
    # 1. Ingest and merge stores
    merged = {}
    for ref in refs:
        code = ref.split(" ", 1)[0]
        merged.update(ingest_book(code, translation))
    merged_path = ROOT / f"data/{translation}-{tag}-merged.json"
    merged_path.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Merged store: {len(merged)} verses")
    # 2. Phos bundle, if all refs are in supported books
    phos_path = ROOT / f"data/phos-{tag}.json"
    phos_arg = []
    # Nov 2, 2026, denomination preset: the plan carries the
    # pastor's denomination (written by the generate route from
    # the local auth database), and the bundle orders that
    # tradition's voices first. Nov 16, 2026, v57 hard filter:
    # the bundle also drops opt-in voices from every other
    # tradition. No flag means today's order, with no opt-in
    # voice passing at all.
    tradition_arg = []
    if plan.get("denomination"):
        tradition_arg = ["--tradition", str(plan["denomination"])]
    try:
        run(["python3", "scripts/phos_context.py", ",".join(refs), str(phos_path)] + tradition_arg)
        phos_arg = [str(phos_path)]
    except subprocess.CalledProcessError:
        print("Phos bundle failed for this passage, continuing without it. Verse text is still in the prompt, quotes are still store-filled.")
    # 2b. Angles, overnight Oct 31, 2026, Step 2: if the plan
    # carries no angles, derive them from Phos, never from the
    # model and never invented. Derived angles are verse-text
    # clauses, with lexicon evidence in the derive output.
    angles = plan.get("angles")
    if not angles or len(angles) != day_count:
        report(2, "Finding the week's angles")
        # Nov 3, 2026, Mac test package: the worker runs under
        # system python3 on a pastor's computer, where no
        # .venv exists. Use this interpreter, not a hardcoded
        # venv path, for the helper scripts.
        derive_cmd = [sys.executable, "scripts/derive_angles.py", ",".join(refs)] + phos_arg
        print("+", " ".join(derive_cmd))
        out = subprocess.run(derive_cmd, cwd=ROOT, capture_output=True, text=True)
        if out.returncode != 0:
            print(out.stdout, out.stderr, file=sys.stderr)
            raise SystemExit("Angle derivation failed, do not generate with invented angles.")
        angles = json.loads(out.stdout)["angles"]
        print(f"Derived angles from Phos: {angles}")
    # 3. Section generation
    draft_path = ROOT / f"data/{tag}-draft.json"
    # Nov 5, 2026, v24 cover note: the plan may carry the
    # pasted or uploaded sermon text (sermonText). Write it
    # to a file next to the draft so generate_sections.py
    # can read it for the snapshot call and store it in the
    # draft for lock-time quote verification. A short text
    # (a verse list, not a sermon) is written too; the
    # sections script itself applies the 150-word sermon
    # test, so no snapshot is ever built from a verse list.
    sermon_file_arg = []
    sermon_text = plan.get("sermonText")
    if isinstance(sermon_text, str) and sermon_text.strip():
        sermon_path = ROOT / f"data/{tag}-sermon.txt"
        sermon_path.write_text(sermon_text, encoding="utf-8")
        sermon_file_arg = ["--sermon-file", str(sermon_path)]
    # Nov 11, 2026, v54, Phase 4 doctrinal profile: the
    # pastor's own statement rides to the section generator
    # as a file, never in a log line and never in a pack.
    # An absent or blank statement means no steering at all:
    # the prompts are byte-identical to v53. The file sits
    # next to the draft, like the sermon file above, and is
    # local-only, like everything else in data/.
    doctrinal_file_arg = []
    doctrinal_text = plan.get("doctrinalStatement")
    if isinstance(doctrinal_text, str) and doctrinal_text.strip():
        doctrinal_path = ROOT / f"data/{tag}-doctrinal.txt"
        doctrinal_path.write_text(doctrinal_text.strip(), encoding="utf-8")
        doctrinal_file_arg = ["--doctrinal-file", str(doctrinal_path)]
    section_cmd = [sys.executable, "scripts/generate_sections.py", tag, str(merged_path),
         plan["passage"], ",".join(refs), ",".join(angles), str(draft_path)] + phos_arg + sermon_file_arg + doctrinal_file_arg
    # Nov 11, 2026, v53: the language rides to the section
    # generator, which runs its prompts, lists, and checks
    # in that language.
    if language == "es":
        section_cmd += ["--lang", "es"]
    if progress_file:
        section_cmd += ["--progress-file", progress_file,
                        "--progress-base", str(section_base),
                        "--progress-total", str(progress_total)]
    run(section_cmd)
    # 4. Hymn match, attach before lock
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    # Nov 3, 2026, church logo: the plan carries the pastor's
    # stored logo path (or null). It rides in the draft so the
    # locked pack and its PDF cover can print the church's own
    # branding. A null logo means no church mark on the cover.
    if plan.get("churchLogo"):
        draft["churchLogo"] = plan["churchLogo"]
        draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    # Nov 11, 2026, v52, Phase 2 member mode: the plan carries
    # the account's role. Stamp it on the draft so review, the
    # lock, and the PDF all see it; a member draft is signed
    # with the member's first name and carries no church.
    if plan.get("mode"):
        draft["mode"] = plan["mode"]
    if plan.get("memberName"):
        draft["memberName"] = plan["memberName"]
    # Nov 11, 2026, v53: stamp the language and translation
    # on the draft, so review, the lock, the PDF, and the
    # bridge all know which store filled its verses. The
    # section generator already stamped language; this is
    # the translation it does not know. The draft is written
    # back whenever anything was stamped, not only for
    # member packs, or the stamps would be lost.
    draft["language"] = language
    draft["translation"] = translation
    # Nov 11, 2026, v54, Phase 4 flexible length: the built
    # length rides on the draft, so review, the lock, and the
    # PDF all know whether it is a 3-, 5-, or 7-day pack.
    draft["dayCount"] = day_count
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    report(section_base + 2 * day_count + 2, "Matching a hymn")
    topics = ",".join(plan.get("topics", []))
    # Nov 3, 2026, Mac test package: Hymn Desk is no longer
    # assumed to live in the VM's workspace. A hymn-desk
    # folder next to the app (the Mac package layout) wins,
    # then the legacy VM path, mirroring generate_sections.
    # If neither exists, the pack simply has no song section;
    # generation never crashes on a missing Hymn Desk (the
    # old code passed a nonexistent cwd to subprocess, which
    # raised instead of falling back).
    hymn_desk = ROOT.parent / "hymn-desk"
    if not hymn_desk.is_dir():
        hymn_desk = Path.home() / "workspace" / "hymn-desk"
    hymn_script = hymn_desk / "scripts" / "match_hymn.py"
    # Nov 11, 2026, v53: Spanish packs match against the
    # Spanish index (15 verified PD hymns), with --lang es.
    hymns_file = hymn_desk / "data" / ("hymns-es.json" if language == "es" else "hymns.json")
    if topics and hymn_script.exists() and hymns_file.exists():
        _hymn_cmd = [sys.executable, str(hymn_script), ",".join(refs), topics, "--json"]
        if language == "es":
            _hymn_cmd += ["--lang", "es"]
        out = subprocess.run(_hymn_cmd, capture_output=True, text=True)
        print(out.stdout)
        try:
            candidates = json.loads(out.stdout)
        except Exception:
            candidates = []
        if candidates:
            hymns = json.loads(hymns_file.read_text(encoding="utf-8"))["hymns"]
            by_id = {h["id"]: h for h in hymns}
            full = [by_id[c["id"]] for c in candidates if c["id"] in by_id]
            if full:
                # Nov 5, 2026, round-5 fallback: when nothing
                # matched exactly, the matcher returns the 5
                # closest related hymns flagged related. They
                # are stored as candidates with NO auto-pick:
                # the pastor picks one in review, or no song.
                # The related flag is review-only metadata; the
                # lock schema strips it from the chosen hymn.
                related_only = bool(candidates[0].get("related"))
                if related_only:
                    for f in full:
                        f["related"] = True
                    draft["hymnCandidates"] = full
                    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
                    print(f"Related hymns offered (no auto-pick): {[h['title'] for h in full]}")
                else:
                    draft["hymn"] = full[0]
                    draft["hymnCandidates"] = full
                    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
                    print(f"Attached hymn: {full[0]['title']} ({full[0]['tune']}), candidates: {[h['title'] for h in full]}")
    elif topics:
        print("Hymn Desk not found, no song section.")
    # Nov 2, 2026, pastor decision: original choruses removed.
    # If no hymn matched, the pack has no song section, and
    # any chorus left in an older draft is stripped here, so
    # a new pack never ships a generated chorus.
    if not draft.get("hymn") and draft.pop("chorus", None) is not None:
        draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
        print("No hymn match, chorus stripped, no song section.")
    report(section_base + 2 * day_count + 3, "Finishing the draft")
    if no_lock:
        # Review-before-lock: expand, do not lock, do not
        # quality-gate as a lock gate here. The review page
        # runs both gates live as the pastor edits, and only
        # the pastor's Approve and Lock can lock this draft.
        expanded_path = ROOT / f"data/{tag}-draft-expanded.json"
        run(["node", "scripts/expand-draft.mjs", str(draft_path), str(merged_path), str(expanded_path)])
        print(f"Done, draft only, NOT locked. Expanded draft: {expanded_path}")
        return 0
    # 5. Quality + lock
    run(["node", "scripts/lock-draft.mjs", str(draft_path), str(merged_path), str(ROOT / f"data/locked-{tag}.json")])
    print(f"Done. Draft: {draft_path}, Locked: data/locked-{tag}.json")
    print("Build the PDF with: node scripts/build-pdf.mjs data/locked-<tag>.json output/pack-<tag>.pdf")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
