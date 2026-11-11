import { cookies } from "next/headers";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary, saveToLibrary } from "../../../lib/auth.mjs";
import { lockPack } from "../../../lib/pack.mjs";

async function session() {
  const store = await cookies();
  return verifySession(store.get("flockpath_session")?.value);
}

export async function GET() {
  const s = await session();
  if (!s) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true, packs: loadLibrary().filter((p) => p.email === s.email) });
}

export async function POST(request) {
  const s = await session();
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.id || !body.title) return Response.json({ ok: false, error: "Pack id and title required." }, { status: 400 });
  // Nov 3, 2026, agent-test fix B2: this route used to accept
  // a "locked" entry with no pack and no hash, which then
  // showed in My packs as a locked pack whose share page
  // 404d. Now it requires the full pack and its hash, and
  // re-verifies the lock server-side against the BSB verse
  // store before saving. The stored pack is the verified
  // result, not the posted body, so a forged pack or hash
  // cannot enter the library. Summary fields stay for the
  // list view.
  if (!body.pack || typeof body.pack !== "object" || !body.lockHash) {
    return Response.json({ ok: false, error: "A locked pack and its lock hash are required." }, { status: 400 });
  }
  let store = {};
  try {
    // Nov 5, 2026, round-3 cover note: the pastor-note verse
    // may cite a book outside the pack's five days, so its
    // book joins the store rebuild, or a valid note verse
    // would fail verification as an unknown reference.
    const refs = [body.pack.memoryVerse?.reference, body.pack.pastorNote?.verse?.reference, ...(body.pack.adultDevotionals ?? []).map((d) => d.scripture?.reference)].filter(Boolean);
    const books = [...new Set(refs.map((r) => String(r).split(" ")[0]))];
    for (const book of books) {
      const f = path.join(process.cwd(), "data", `bsb-${book}.json`);
      if (!existsSync(f)) return Response.json({ ok: false, error: `Cannot verify this pack: no verse store for ${book}.` }, { status: 400 });
      Object.assign(store, JSON.parse(readFileSync(f, "utf-8")));
    }
  } catch {
    return Response.json({ ok: false, error: "Cannot verify this pack." }, { status: 400 });
  }
  const verified = lockPack(body.pack, store, "bsb");
  if (!verified.ok) return Response.json({ ok: false, error: `Pack does not verify: ${verified.errors.join(" ")}` }, { status: 400 });
  if (verified.pack.lockHash !== body.lockHash) return Response.json({ ok: false, error: "Lock hash does not match the pack." }, { status: 400 });
  if (verified.pack.id !== body.id) return Response.json({ ok: false, error: "Pack id does not match the entry id." }, { status: 400 });
  const entry = {
    id: verified.pack.id, title: verified.pack.title, passage: verified.pack.passage ?? "",
    email: s.email, pastorName: s.name, church: s.church,
    status: "locked", lockHash: verified.pack.lockHash,
    savedAt: new Date().toISOString(),
    pack: verified.pack,
  };
  saveToLibrary(entry);
  return Response.json({ ok: true, entry });
}
