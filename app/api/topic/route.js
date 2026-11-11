import { cookies } from "next/headers";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";

const run = promisify(execFile);

// Overnight Oct 31, 2026, Step 1: topic search wired into /input.
// Session-gated like /api/extract. Calls scripts/topic_search.py
// with --json, which returns curated topical refs first and
// devotional anchors second. The API never picks a passage:
// it returns suggestions, the pastor picks refs on the page.
export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  if (!topic) return Response.json({ ok: false, error: "Type a topic word first, for example shepherd or grace." }, { status: 400 });
  if (topic.length > 80) return Response.json({ ok: false, error: "Topic is too long, use one word or a short phrase." }, { status: 400 });
  try {
    const script = path.join(process.cwd(), "scripts", "topic_search.py");
    const { stdout } = await run("python3", [script, "--json", topic], { cwd: process.cwd(), timeout: 30000 });
    const data = JSON.parse(stdout);
    return Response.json({ ok: true, ...data });
  } catch (e) {
    // Nov 4, 2026, logging: same rule as the PDF route, a
    // failed search leaves a trace in the app log, not only
    // in the response the pastor sees.
    console.error(`Topic search failed for "${topic}":`, e);
    return Response.json({ ok: false, error: `Topic search failed: ${String(e.message || e).slice(0, 200)}` }, { status: 500 });
  }
}
