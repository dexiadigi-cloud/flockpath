import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { verifySession, getPastor } from "../../../lib/auth.mjs";
import { BOOK_NAMES } from "../../../lib/refs.mjs";

// Overnight Oct 31, 2026, Step 6: Generate button, honest version.
// Nov 1, 2026, worker step: this route still records a job and
// returns its status, and still does NOT run the model inside a
// web request. The difference is scripts/generate_worker.py now
// picks up queued jobs, runs generate_from_plan.py (about 10
// minutes per pack), and on a verified lock puts the pack in the
// library and builds its PDF. The UI text must stay honest about
// that: recording is not finishing.
const JOBS = path.join(process.cwd(), "data", "generate-jobs");

function jobPath(id) {
  return path.join(JOBS, `${id}.json`);
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const passage = String(body.passage ?? "").trim();
  const refs = Array.isArray(body.refs) ? body.refs.map((r) => String(r).trim()) : [];
  const topics = Array.isArray(body.topics) ? body.topics.map((t) => String(t).trim()).filter(Boolean) : [];
  // Nov 5, 2026, v24 cover note: the pasted or uploaded
  // sermon text rides in the plan so generation can build
  // the cover snapshot from it. Capped at 100,000 chars;
  // a sermon is far below that, and the sections script
  // itself only treats 150+ words as a sermon. It lives
  // only in this local job file and the local pack, never
  // sent anywhere.
  const sermonText = typeof body.sermonText === "string" ? body.sermonText.slice(0, 100000).trim() : "";
  // Nov 11, 2026, v53, Phase 3 Spanish v1: the language and
  // translation ride in the plan, so the worker ingests the
  // right store and generates in the right language. Valid
  // pairs only: en/bsb, es/rv1909, es/spabes. RVR1960 is
  // copyrighted and is never accepted. Absent means en/bsb,
  // so older input pages keep working.
  const language = String(body.language ?? "en").trim().toLowerCase();
  const translation = String(body.translation ?? "bsb").trim().toLowerCase();
  const _pairOk = (language === "en" && translation === "bsb") || (language === "es" && (translation === "rv1909" || translation === "spabes"));
  if (!_pairOk) return Response.json({ ok: false, error: "Language and translation must agree: English with BSB, Spanish with Reina-Valera 1909 or Español Sencillo 2026." }, { status: 400 });
  if (!passage) return Response.json({ ok: false, error: "A passage is required." }, { status: 400 });
  // v28, Nov 5, 2026: a range (Matthew 28:18-20) is one
  // passage unit, so a ref may be a single verse or a
  // same-chapter range. The units are still distinct.
  // Nov 11, 2026, v54, Phase 4 flexible length: a pack is
  // 3, 5, or 7 days, so the plan carries that many refs.
  // Anything else is rejected here, before a job is queued.
  if (![3, 5, 7].includes(refs.length) || refs.some((r) => !/^[A-Z0-9]+ \d+:\d+(-\d+)?$/.test(r))) {
    return Response.json({ ok: false, error: "A generation job needs 3, 5, or 7 verse refs, confirmed on the input page." }, { status: 400 });
  }
  // Nov 3, 2026, agent-test fix B3: duplicate refs and unknown
  // book codes used to queue jobs that could never produce a
  // good pack (duplicates collapse to one day; an unknown book
  // fails verse lookup in the worker), so the pastor waited
  // for a preventable failure. Reject both at record time.
  if (new Set(refs).size !== refs.length) {
    return Response.json({ ok: false, error: `Each of the ${refs.length} verse refs must be different. Duplicates collapse to one day.` }, { status: 400 });
  }
  if (refs.some((r) => !BOOK_NAMES[r.split(" ")[0]])) {
    return Response.json({ ok: false, error: "One of the verse refs uses an unknown book code. Use a book from the 66-book Bible." }, { status: 400 });
  }
  mkdirSync(JOBS, { recursive: true });
  const id = randomBytes(8).toString("hex");
  // Nov 2, 2026, denomination preset: the plan carries the
  // pastor's stored denomination so the bundle orders that
  // tradition's voices first. Nov 16, 2026, v57 hard filter:
  // the bundle also drops opt-in voices from every other
  // tradition, so they can never appear in this pastor's pack.
  // It lives only in this local job file and the local auth
  // database, never in a pack.
  // Nov 3, 2026, church logo: unlike the denomination, the
  // logo DOES go into the pack, because it is the church's
  // own branding, chosen by the pastor, printed on the cover.
  const pastor = getPastor(s.email);
  // Nov 11, 2026, v52, Phase 2 member mode: the plan carries
  // the account's role, so the draft is a member pack from
  // the start. Declared here, before the lines that use it:
  // the doctrinal statement and the church logo both depend
  // on the role, and a use before this line is a ReferenceError
  // at request time (v54 live-test catch, Nov 11, 2026).
  const role = pastor?.role ?? "pastor";
  const denomination = pastor?.denomination ?? "non-denominational";
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: the plan
  // carries the pastor's stored statement so the worker can
  // steer the writing model and run the review check. It
  // lives only in this local job file and the local auth
  // database, never in a pack. Members have no statement;
  // their packs use the default guidance.
  const doctrinalStatement = role === "member" ? "" : (pastor?.doctrinalStatement ?? "");
  // A member has no church logo; the logo is a pastor-only
  // item, so it is never attached to a member job.
  const churchLogo = role === "member" ? null : (pastor?.logo ?? null);
  // Nov 5, 2026, v33 (Google API first): the plan records which
  // writing model the pastor picked (local 4B or Google Gemini),
  // so the pack record shows how it was written. The worker reads
  // the live setting from the auth database at run time; the plan
  // value is the record of what was picked when the job was queued.
  // The key itself is never in the plan.
  // Nov 9, 2026, v43 (Grok API first): the backend can also be
  // Grok (xAI). Grok is the API going forward.
  const modelBackend = pastor?.modelBackend ?? "local";
  const job = {
    id, status: "queued", createdAt: new Date().toISOString(),
    email: s.email, pastorName: s.name, church: s.church, mode: role,
    plan: { passage, refs, topics, dayCount: refs.length, denomination, ...(doctrinalStatement ? { doctrinalStatement } : {}), churchLogo, modelBackend, mode: role, language, translation, ...(role === "member" ? { memberName: s.name } : {}), ...(sermonText ? { sermonText } : {}) },
    note: "Job recorded only. The worker generates a draft, which takes ~10 minutes with OpenRouter, Grok, or Google, or up to 30 minutes with the local model depending on your computer, and stops. Nothing is locked or published until the pastor reviews and approves it.",
  };
  writeFileSync(jobPath(id), JSON.stringify(job, null, 1));
  writeFileSync(path.join(JOBS, `${id}-plan.json`), JSON.stringify(job.plan, null, 1));
  return Response.json({ ok: true, job });
}

export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  if (!existsSync(jobPath(id))) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  const job = JSON.parse(readFileSync(jobPath(id), "utf-8"));
  if (job.email !== s.email) return Response.json({ ok: false, error: "Job not found." }, { status: 404 });
  // Nov 3, 2026, generation step display: the pipeline writes
  // a progress file next to the job while it runs. Attach it
  // when present and well-formed, so the input page can show
  // the current step. A missing or corrupt file means no step
  // line, never an error.
  const progressPath = path.join(JOBS, `${id}-progress.json`);
  if (existsSync(progressPath)) {
    try {
      const p = JSON.parse(readFileSync(progressPath, "utf-8"));
      if (Number.isInteger(p.step) && Number.isInteger(p.total) && typeof p.label === "string") {
        job.progress = { step: p.step, total: p.total, label: p.label };
      }
    } catch { /* no step line */ }
  }
  return Response.json({ ok: true, job });
}
