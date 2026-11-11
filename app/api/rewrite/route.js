import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";

// Nov 5, 2026, v32: Rewrite a section that quotes its verse
// verbatim. Jeremiah's request: when the review page flags an
// adult body for quoting its verse verbatim, the pastor should
// be able to click Rewrite and have the model rewrite just the
// offending paragraph(s) in its own words, instead of deleting
// a whole paragraph by hand (a large edit that defeats the
// purpose of the app). This route records a rewrite request
// and returns its id; it does NOT run the model inside a web
// request. scripts/generate_worker.py picks up queued rewrite
// requests, runs scripts/rewrite_section.py (about 2-3 minutes:
// model load plus one paraphrase call per offending paragraph),
// and writes the result next to the request. The review page
// polls GET until the result is done, then swaps the new body
// into the draft. The verse is never in the model prompt, so
// the model cannot quote it again from the prompt; the result
// is verified in code against the verse before it is returned.
const JOBS = path.join(process.cwd(), "data", "rewrite-jobs");

function reqPath(id) {
  return path.join(JOBS, `${id}.json`);
}

function resultPath(id) {
  return path.join(JOBS, `${id}-result.json`);
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const draftId = String(body.draftId ?? "").trim();
  const day = String(body.day ?? "").trim();
  const text = String(body.body ?? "").trim();
  const verseRef = String(body.verseRef ?? "").trim();
  const verseText = String(body.verseText ?? "").trim();
  if (!draftId) return Response.json({ ok: false, error: "A draft id is required." }, { status: 400 });
  if (!day) return Response.json({ ok: false, error: "A day is required." }, { status: 400 });
  if (!text) return Response.json({ ok: false, error: "Nothing to rewrite." }, { status: 400 });
  if (!verseRef || !verseText) return Response.json({ ok: false, error: "The verse is required, so the rewrite can be verified against it." }, { status: 400 });
  mkdirSync(JOBS, { recursive: true });
  const id = randomBytes(8).toString("hex");
  const req = {
    id, status: "queued", createdAt: new Date().toISOString(),
    email: s.email, draftId, day, body: text, verseRef, verseText,
    note: "Rewrite recorded only. The worker rewrites the paragraph(s) that quote the verse, which takes about 2-3 minutes, and the review page picks up the result. Nothing in the draft changes until the pastor sees the new text.",
  };
  writeFileSync(reqPath(id), JSON.stringify(req, null, 1));
  return Response.json({ ok: true, id });
}

export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ ok: false, error: "Rewrite not found." }, { status: 404 });
  if (!existsSync(reqPath(id))) return Response.json({ ok: false, error: "Rewrite not found." }, { status: 404 });
  const req = JSON.parse(readFileSync(reqPath(id), "utf-8"));
  if (req.email !== s.email) return Response.json({ ok: false, error: "Rewrite not found." }, { status: 404 });
  if (existsSync(resultPath(id))) {
    try {
      const result = JSON.parse(readFileSync(resultPath(id), "utf-8"));
      return Response.json({ ok: true, status: "done", result });
    } catch { /* a corrupt result means not done yet */ }
  }
  return Response.json({ ok: true, status: req.status ?? "queued", result: null });
}
