import { cookies } from "next/headers";
import { verifySession } from "../../../lib/auth.mjs";
import { extractRefs } from "../../../lib/extract.mjs";

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const text = String(body.text ?? "");
  if (!text.trim()) return Response.json({ ok: false, error: "Paste a sermon, a verse list, or a passage first." }, { status: 400 });
  // Nov 11, 2026, v54, Phase 4 flexible length: the caller
  // may ask for a 3-, 5-, or 7-day proposal; anything else
  // falls back to the 5-day default in extractRefs.
  const dayCount = Number(body.dayCount ?? 5);
  return Response.json({ ok: true, ...extractRefs(text, dayCount) });
}
