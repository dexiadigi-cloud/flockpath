"""Background worker for Flockpath generation jobs, Nov 1, 2026.

Why this exists: the /input Generate button records a job, but a
model run takes about 20 minutes and does not belong inside a web
request. This worker is the missing link: it picks up a queued job
and runs the proven generate_from_plan pipeline.

Nov 1, 2026, review-before-lock: the worker generates a DRAFT
and stops. It does NOT lock, does NOT build a PDF, and does
NOT put a pack in the locked library. The pastor opens the
draft on the review page, checks it, edits, swaps the hymn
if they want, and only then taps Approve and Lock. That lock
is what creates the library entry, the PDF, and the share page.

Usage:
  python3 scripts/generate_worker.py --once        # one queued job, then exit
  python3 scripts/generate_worker.py --once --job <id>
  python3 scripts/generate_worker.py --loop        # poll every 60s until stopped

Rules, in order:
1. One job at a time, in created order. No parallel model runs.
2. A job is marked running before the model starts, then
   ready_for_review only after an expanded draft is saved.
   Failed with the error tail otherwise. A failed job never
   creates a draft, and a draft never appears on the public
   share page, which only ever renders locked packs.
3. The worker never quotes Scripture from memory. All verse text
   comes from the verse store through the pipeline.
6. Resume, Nov 1, 2026: generate_sections.py checkpoints every
   finished section, so a rerun with the same job tag reuses
   finished sections and generates only missing ones. A job
   left running by a killed worker is continued through
   /api/generate/continue, never by silently restarting it
   from scratch.
"""
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "data" / "generate-jobs"
LIB = ROOT / "data" / "packs-library.json"
LOCKED = ROOT / "data" / "locked-pack.json"
TYPST = ROOT / "tools" / "typst-x86_64-unknown-linux-musl" / "typst"
# Nov 5, 2026, demo-pack rebuild: the old 3600 s cap was
# shorter than a full VM-CPU pack (75-120 min; step 13 alone,
# 5 leader questions x up to 3 length retries, took over an
# hour), so two demo runs died at step 13 with nothing to
# show for the hour. The cap is now 3 hours, comfortably
# above the worst legitimate CPU pack. On the Mac (GPU,
# ~3 min) it never binds. A hung job is still killed, just
# later, and the kill now takes the whole process tree (see
# the run block below).
WORKER_TIMEOUT_S = 10800


def now():
    return datetime.now(timezone.utc).isoformat()


def load_job(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_job(path, job):
    path.write_text(json.dumps(job, indent=1), encoding="utf-8")


def queued_jobs():
    jobs = []
    if not JOBS.exists():
        return jobs
    for path in sorted(JOBS.glob("*.json")):
        if path.name.endswith("-plan.json"):
            continue
        try:
            job = load_job(path)
        except Exception:
            continue
        if job.get("status") in ("queued", "interrupted"):
            jobs.append((path, job))
    jobs.sort(key=lambda pair: pair[1].get("createdAt", ""))
    return jobs


def all_jobs():
    jobs = []
    if not JOBS.exists():
        return jobs
    for path in sorted(JOBS.glob("*.json")):
        if path.name.endswith("-plan.json"):
            continue
        try:
            jobs.append((path, load_job(path)))
        except Exception:
            continue
    return jobs


# Nov 5, 2026, v32: rewrite requests. A pastor on the review
# page clicks Rewrite on an adult body that quotes its verse
# verbatim; the request waits here until the worker picks it
# up. A rewrite is one model load plus one paraphrase call per
# offending paragraph (about 2-3 minutes), far quicker than a
# full pack, so rewrites are checked first in each loop pass
# and run before any queued generate job. One model at a time,
# same as generation: a rewrite never runs while a pack is
# generating, and a generate job never starts while a rewrite
# is running.
REWRITE_JOBS = ROOT / "data" / "rewrite-jobs"


# Nov 5, 2026, v33 (Google API first): the model backend comes from the
# pastor's stored setting in data/auth.db (modelBackend 'local' or
# 'gemini', geminiApiKey). The worker reads it at run time, so a key
# rotation or a backend switch takes effect on the next job without a
# restart. The key is passed to the child only through the subprocess
# environment, never written to a file and never printed. If the
# columns are missing (an older install) or no key is stored, the
# backend is 'local' and generation works exactly as before.
# Nov 9, 2026, v43 (Grok API first): the backend can also be 'grok'
# (grokApiKey). The worker passes the matching key: FLOCKPATH_GROK_API_KEY
# for grok, FLOCKPATH_GEMINI_API_KEY for gemini. Grok is the API going
# forward because Google's Gemini free tier stopped working (403).
# Nov 9, 2026, v47 (OpenRouter first): the backend can also be
# 'openrouter' (openrouterApiKey). The worker passes the matching key:
# FLOCKPATH_OPENROUTER_API_KEY for openrouter. OpenRouter serves GLM
# 5.3 Flash, the cheapest capable model found (about $0.01 a pack (measured Nov 9)).
def get_pastor_model(email):
    db_path = ROOT / "data" / "auth.db"
    if not email or not db_path.exists():
        return ("local", None)
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT modelBackend, geminiApiKey, grokApiKey, openrouterApiKey FROM pastors WHERE email = ?",
                (str(email).strip().lower(),)).fetchone()
        except sqlite3.OperationalError:
            return ("local", None)
        finally:
            conn.close()
    except Exception:
        return ("local", None)
    if not row:
        return ("local", None)
    backend = (row[0] or "local").strip().lower()
    if backend not in ("local", "gemini", "grok", "openrouter"):
        backend = "local"
    key = None
    if backend == "gemini":
        key = (row[1] or "").strip() or None
    elif backend == "grok":
        key = (row[2] or "").strip() or None
    elif backend == "openrouter":
        key = (row[3] or "").strip() or None
    return (backend, key)


def model_env(email):
    """Environment for a model child process: the backend, plus the
    matching key only when the backend is gemini, grok, or openrouter
    and a key is stored."""
    backend, key = get_pastor_model(email)
    env = dict(os.environ)
    env["FLOCKPATH_BACKEND"] = backend
    if backend == "gemini" and key:
        env["FLOCKPATH_GEMINI_API_KEY"] = key
    if backend == "grok" and key:
        env["FLOCKPATH_GROK_API_KEY"] = key
    if backend == "openrouter" and key:
        env["FLOCKPATH_OPENROUTER_API_KEY"] = key
    return env


def queued_rewrites():
    reqs = []
    if not REWRITE_JOBS.exists():
        return reqs
    for path in sorted(REWRITE_JOBS.glob("*.json")):
        if path.name.endswith("-result.json"):
            continue
        try:
            req = load_job(path)
        except Exception:
            continue
        if req.get("status") in ("queued", "interrupted"):
            reqs.append((path, req))
    reqs.sort(key=lambda pair: pair[1].get("createdAt", ""))
    return reqs


def run_rewrite(path, req):
    # Mark running first, so a restart does not silently
    # re-run it from scratch. The script writes the result
    # file; a missing result after a failed run means the
    # review page keeps polling and the pastor sees the
    # request still queued, never a silent success.
    req["status"] = "running"
    save_job(path, req)
    print(f"Rewrite {req['id']} ({req.get('day', '?')}, {req.get('verseRef', '?')}): running.", flush=True)
    try:
        proc = subprocess.run(
            [sys.executable, "scripts/rewrite_section.py", req["id"]],
            cwd=ROOT, capture_output=True, text=True, timeout=900,
            env=model_env(req.get("email")))
        print(proc.stdout[-2000:] if proc.stdout else "", flush=True)
        if proc.returncode != 0:
            print(proc.stderr[-2000:] if proc.stderr else "", flush=True)
            raise RuntimeError(f"rewrite_section.py exited {proc.returncode}")
        req["status"] = "done"
        save_job(path, req)
        print(f"Rewrite {req['id']}: done.", flush=True)
    except Exception as e:
        req["status"] = "failed"
        req["error"] = str(e)[-500:]
        save_job(path, req)
        print(f"Rewrite {req['id']}: FAILED: {e}", flush=True)


def restore_locked(backup):
    shutil.copyfile(backup, LOCKED)
    subprocess.run(["node", "scripts/build-pdf.mjs"], cwd=ROOT,
                   capture_output=True, text=True)


def run_job(path, job):
    # Nov 1, 2026, review-before-lock: the worker generates a
    # DRAFT and stops. It does NOT lock, does NOT build a PDF,
    # and does NOT put a pack in the locked library. Locking is
    # the pastor's act on the review page, after they check
    # the draft, edit it, and swap the hymn if they want.
    # A job that fails never creates a draft, and a draft is
    # never shown on the public share page, which only ever
    # renders locked packs.
    tag = f"job-{job['id']}"
    plan_path = JOBS / f"{job['id']}-plan.json"
    progress_path = JOBS / f"{job['id']}-progress.json"
    # Nov 3, 2026, generation step display: drop any progress
    # left by an earlier run, so the pastor never sees a stale
    # step for a job that just restarted.
    progress_path.unlink(missing_ok=True)
    job["status"] = "running"
    job["startedAt"] = now()
    save_job(path, job)
    # Nov 4, 2026, worker logging (Mac test items 28, 30):
    # every print below used to run without flush, so with
    # stdout redirected to worker-<date>.log Python held the
    # output in its block buffer for the whole run. That is
    # why a full Mac generation left only the start line in
    # the log: the pickup, progress, and finish lines were
    # still buffered when the log was collected. Every print
    # now flushes, and the run opens with a pickup line
    # naming the job and passage, so a collected log always
    # shows what the worker actually did.
    print(f"Picked up job {job['id']} (passage {job.get('plan', {}).get('passage', '')}, {len(job.get('plan', {}).get('refs', []))} refs)", flush=True)
    try:
        # Nov 5, 2026, fresh-eyes test: this used to spawn
        # bare "python3", which is the SYSTEM interpreter.
        # On the VM the model packages (llama_cpp, pypdf)
        # live only in .venv, so every generation died at
        # the llama_cpp import within seconds, while the
        # startup check (which verifies the worker's own
        # interpreter) passed and looked healthy. The worker
        # must spawn its own interpreter, so the whole chain
        # uses the interpreter the starter already verified.
        # On the Mac the worker runs under system python3
        # (where the packages are installed), so
        # sys.executable is system python3 there - same
        # behavior as before, no change.
        # Nov 5, 2026, demo-pack rebuild: subprocess.run's
        # timeout kills only the direct child. The generator
        # spawns its own child (generate_sections.py), which
        # used to survive a timeout as an orphan, still
        # generating and competing for CPU while the next run
        # started. The run now has its own process group
        # (start_new_session), and a timeout kills the whole
        # group, so no runaway generator can survive it.
        proc = subprocess.Popen(
            [sys.executable, "scripts/generate_from_plan.py",
             str(plan_path), tag, "--no-lock",
             "--progress-file", str(progress_path)],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True,
            env=model_env(job.get("email")))
        try:
            stdout, stderr = proc.communicate(timeout=WORKER_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            stdout, stderr = proc.communicate()
            raise RuntimeError(f"pipeline timed out after {WORKER_TIMEOUT_S}s")
        # v36, Nov 6, 2026: the worker log kept only the last
        # 3000 chars, which cut off the "Sermon snapshot" line
        # (it sits ~1300 chars before the end) and made the
        # Power of Cross G2 missing-snapshot undiagnosable
        # from the log. 12000 covers a full pack's output.
        print(stdout[-12000:], flush=True)
        if proc.returncode != 0:
            raise RuntimeError(stderr[-2000:] or "pipeline failed")
        expanded_path = ROOT / f"data/{tag}-draft-expanded.json"
        draft = json.loads(expanded_path.read_text(encoding="utf-8"))
        if draft.get("status") != "draft":
            raise RuntimeError("pipeline finished without a draft")
        drafts_dir = ROOT / "data" / "drafts"
        drafts_dir.mkdir(exist_ok=True)
        draft_file = drafts_dir / f"{tag}.json"
        draft_file.write_text(json.dumps({
            "id": draft["id"],
            "jobId": job["id"],
            "email": job["email"],
            "pastorName": job.get("pastorName", ""),
            "church": job.get("church", ""),
            "createdAt": now(),
            "draft": draft,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        job["status"] = "ready_for_review"
        job["draftId"] = draft["id"]
        job["finishedAt"] = now()
        save_job(path, job)
        print(f"Ready for review: job {job['id']} -> draft {draft['id']}", flush=True)
        return True
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)[-2000:]
        job["finishedAt"] = now()
        save_job(path, job)
        print(f"Failed: job {job['id']}: {exc}", flush=True)
        return False


def main():
    args = sys.argv[1:]
    loop = "--loop" in args
    only = None
    if "--job" in args:
        only = args[args.index("--job") + 1]
    if loop:
        print("Worker started, polling for queued jobs every 60s.", flush=True)
    while True:
        # v32: rewrites first. They are quick (about 2-3
        # minutes) and the pastor is waiting on the review
        # page, so a queued rewrite runs before any queued
        # pack generation. One model at a time either way.
        rewrites = queued_rewrites()
        if rewrites and not only:
            path, req = rewrites[0]
            run_rewrite(path, req)
            if not loop:
                return 0
            continue
        jobs = queued_jobs()
        if only:
            # Resume case, Nov 1, 2026: a runtime restart killed a
            # worker mid-generation, leaving its job "running"
            # with no draft yet. Re-running it is safe: the
            # pipeline regenerates sections from scratch, and
            # nothing is locked or added to the library until
            # lock-draft says LOCK true.
            jobs = [(p, j) for p, j in all_jobs() if j["id"] == only
                    and j.get("status") in ("queued", "running", "interrupted")]
            if not jobs:
                print(f"No queued or running job {only}")
                return 0
        if not jobs:
            if loop:
                time.sleep(60)
                continue
            print("No queued jobs.")
            return 0
        path, job = jobs[0]
        run_job(path, job)
        if not loop:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
