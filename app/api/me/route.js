import { cookies } from "next/headers";
import { verifySession, getPastor, setDenomination, setDoctrinalStatement, setNarrationVoice } from "../../../lib/auth.mjs";
import { denominationMessage } from "../../../lib/denominations.mjs";

// Nov 2, 2026, denomination setting: the signed-in pastor's own
// setting, read and changed here. The setting lives only in the
// local auth database on the pastor's own computer. It is never
// sent anywhere else, and it never appears in a pack or PDF.
// Nov 11, 2026, v54, Phase 4 doctrinal profile: the same route
// also saves the pastor's doctrinal statement. The statement
// steers the writing model and the review check; it is never
// printed in a pack, and it is sent nowhere except to the
// writing model the pastor already chose, as part of the pack's
// own prompts.

export async function GET() {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const pastor = getPastor(s.email);
  if (!pastor) return Response.json({ ok: false, error: "Pastor not found." }, { status: 404 });
  return Response.json({ ok: true, ...pastor });
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    let pastor = getPastor(s.email);
    if (!pastor) return Response.json({ ok: false, error: "Pastor not found." }, { status: 404 });
    if (body.denomination !== undefined) {
      pastor = setDenomination(s.email, body.denomination);
      return Response.json({ ok: true, ...pastor, message: denominationMessage(pastor.denomination) });
    }
    if (body.narrationVoice) {
      // Nov 11, 2026, v54, Phase 4 audio narration: the
      // pastor's picked voice, one of the four English Kokoro
      // voices. An unknown voice is refused by the setter.
      pastor = setNarrationVoice(s.email, body.narrationVoice);
      return Response.json({ ok: true, ...pastor, message: "Saved. New narrations use this voice." });
    }
    if (body.doctrinalStatement !== undefined) {
      pastor = setDoctrinalStatement(s.email, body.doctrinalStatement);
      return Response.json({ ok: true, ...pastor, message: "Saved. It steers the writing model for your future packs, and review will flag anything that leans against it." });
    }
    return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
