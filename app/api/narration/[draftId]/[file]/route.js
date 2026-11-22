import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../../../lib/auth.mjs";
import { resolveNarrationSource } from "../../../../../lib/narration.mjs";

// Nov 11, 2026, v54, Phase 4 audio narration: streams one
// narration WAV for a draft the signed-in pastor owns. The
// audio lives under data/narration/, never under public/, so
// it is only reachable behind sign-in, like the pack itself.
// The file name is allow-listed to a day and a kind, so no
// path can escape the pack's own folder.
// Nov 20, 2026, v62, item 12: narration belongs to the PACK,
// not the review step. Once a draft is approved the draft
// file is deleted, so this route now also accepts a locked
// (or personal) library pack owned by the same account: the
// audio stays reachable on the pack page after approval.
// The id is a draft job id or a pack id - the same id space,
// a pack's id is its draft's job id.

export async function GET(request, { params }) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { draftId, file } = await params;
  if (!/^job-[0-9a-f]{16}$/.test(String(draftId ?? ""))) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 400 });
  if (!/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-(adult|kid)\.wav$/.test(String(file ?? ""))) {
    return Response.json({ ok: false, error: "Unknown audio file." }, { status: 400 });
  }
  // Owner check: a draft still awaiting review, or a locked
  // (or personal) pack in this account's library. Either one
  // proves this audio belongs to the signed-in pastor.
  if (!resolveNarrationSource(draftId, s.email)) return Response.json({ ok: false, error: "This narration belongs to another account." }, { status: 403 });
  const audioPath = path.join(process.cwd(), "data", "narration", draftId, file);
  if (!existsSync(audioPath)) return Response.json({ ok: false, error: "This narration has not been made yet." }, { status: 404 });
  const bytes = readFileSync(audioPath);
  return new Response(bytes, { headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename="${file}"` } });
}
