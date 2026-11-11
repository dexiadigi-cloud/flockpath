import { cookies } from "next/headers";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";

// Nov 4, 2026, review logging (Mac pastor-role test items
// 19, 30): the review page no longer shows length checks to
// the pastor, but the detail must live somewhere. It lives
// here, in data/logs/review-<local-date>.log, one JSON line
// per changed verdict, next to the app and worker logs, so
// the collect-logs script picks it up with everything else.
// Fire-and-forget from the review page: a logging failure
// here never disturbs a review.
export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const dir = path.join(process.cwd(), "data", "logs");
    mkdirSync(dir, { recursive: true });
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const line = JSON.stringify({
      at: now.toISOString(),
      email: s.email,
      draftId: body.draftId ?? null,
      scripture: body.scripture ?? null,
      quality: body.quality ?? null,
    });
    appendFileSync(path.join(dir, `review-${local}.log`), line + "\n");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Could not write review log." }, { status: 500 });
  }
}
