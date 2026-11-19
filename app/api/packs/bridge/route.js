import { cookies } from "next/headers";
import { verifySession, loadLibrary } from "../../../../lib/auth.mjs";
import { exportBridgeDraft } from "../../../../lib/pack.mjs";

// Nov 11, 2026, v52, Phase 2 member mode: download the
// send-to-pastor bridge file for a saved personal study.
// The file carries references only, never Scripture text:
// the pastor's app re-retrieves every verse from its own
// BSB store on import. Only the member who saved the study
// can download its bridge file, and only a personal study
// has one: a locked pastor pack is never exported this way.
export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ ok: false, error: "Pack id required." }, { status: 400 });
  const entry = loadLibrary().find((e) => e.id === id && e.email === s.email);
  if (!entry?.pack) return Response.json({ ok: false, error: "Pack not found in your library." }, { status: 404 });
  if (entry.status !== "personal" || (entry.pack.mode ?? "pastor") !== "member") {
    return Response.json({ ok: false, error: "Only a personal study can be sent to a pastor this way." }, { status: 400 });
  }
  const bridge = exportBridgeDraft(entry.pack, entry.memberName || entry.pack.memberName || s.name);
  const body = JSON.stringify(bridge, null, 1);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="flockpath-member-draft-${entry.id}.json"`,
    },
  });
}
