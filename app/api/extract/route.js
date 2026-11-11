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
  return Response.json({ ok: true, ...extractRefs(text) });
}
