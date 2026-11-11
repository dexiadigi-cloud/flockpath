import { cookies } from "next/headers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../../lib/auth.mjs";

// Nov 1, 2026, resume requirement: a pack takes about 10
// minutes, so an interruption halfway must not mean starting
// over. Finished sections live in a checkpoint file next to
// the draft, and the worker reuses them on rerun.
// This route is the pastor's Continue button. It does NOT
// run the model itself. It moves a job that is running,
// failed, or interrupted back to queued, so the worker picks
// it up and generates only the missing sections. A done job
// is never resumed, and another pastor's job is never visible.
const JOBS = path.join(process.cwd(), "data", "generate-jobs");

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  const jobPath = path.join(JOBS, `${id}.json`);
  if (!existsSync(jobPath)) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  const job = JSON.parse(readFileSync(jobPath, "utf-8"));
  if (job.email !== s.email) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  if (job.status === "done") return Response.json({ ok: false, error: "That pack is already finished." }, { status: 400 });
  // Nov 3, 2026, agent-test fix W18: a merely queued job
  // used to continue successfully and re-mark itself, which
  // the route's own comment never allowed. Only running,
  // failed, or interrupted jobs continue; a queued job is
  // already waiting for the worker.
  if (!["running", "failed", "interrupted"].includes(job.status)) {
    return Response.json({ ok: false, error: `Job is ${job.status}, it cannot be continued.` }, { status: 400 });
  }
  job.status = "queued";
  job.resumedAt = new Date().toISOString();
  job.note = "Interrupted, then continued. Finished sections are reused from the checkpoint, only missing sections are generated, so it does not start over.";
  writeFileSync(jobPath, JSON.stringify(job, null, 1));
  return Response.json({ ok: true, job });
}
