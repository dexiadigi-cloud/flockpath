import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../../../lib/auth.mjs";

// Nov 11, 2026, v54, Phase 4 audio narration: streams one
// narration WAV for a draft the signed-in pastor owns. The
// audio lives under data/narration/, never under public/, so
// it is only reachable behind sign-in, like the pack itself.
// The file name is allow-listed to a day and a kind, so no
// path can escape the draft's own folder.

export async function GET(request, { params }) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { draftId, file } = await params;
  if (!/^job-[0-9a-f]{16}$/.test(String(draftId ?? ""))) return Response.json({ ok: false, error: "Unknown draft." }, { status: 400 });
  if (!/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-(adult|kid)\.wav$/.test(String(file ?? ""))) {
    return Response.json({ ok: false, error: "Unknown audio file." }, { status: 400 });
  }
  const draftPath = path.join(process.cwd(), "data", "drafts", `${draftId}.json`);
  if (!existsSync(draftPath)) return Response.json({ ok: false, error: "Unknown draft." }, { status: 404 });
  try {
    const stored = JSON.parse(readFileSync(draftPath, "utf-8"));
    if (stored.email !== s.email) return Response.json({ ok: false, error: "This draft belongs to another account." }, { status: 403 });
  } catch {
    return Response.json({ ok: false, error: "This draft could not be read." }, { status: 400 });
  }
  const audioPath = path.join(process.cwd(), "data", "narration", draftId, file);
  if (!existsSync(audioPath)) return Response.json({ ok: false, error: "This narration has not been made yet." }, { status: 404 });
  const bytes = readFileSync(audioPath);
  return new Response(bytes, { headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename="${file}"` } });
}
