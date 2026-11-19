import { cookies } from "next/headers";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { verifySession, getPastor, saveToLibrary } from "../../../../lib/auth.mjs";
import { Pack, verifyPack } from "../../../../lib/pack.mjs";

// Nov 11, 2026, v52, Phase 2 member mode: saving a personal
// study. A member reviews a draft with the same gates as a
// pastor, then saves it as their own study. This route
// verifies every Scripture quote against the BSB store,
// exactly like the lock route, but mints no hash and writes
// no lock: the entry is status "personal", never "locked",
// and the PDF carries the mandatory label instead of an
// approval code. A member pack that tries to carry a church,
// a church logo, or a lock hash is refused outright, and the
// lock route refuses member packs the same way, so there is
// no path, in the UI or direct, that puts a lock on one.
export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const pastor = getPastor(s.email);
  if (!pastor || pastor.role !== "member") return Response.json({ ok: false, error: "Only a member account can save a personal study." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const pack = body.pack;
  if (!pack || typeof pack !== "object") return Response.json({ ok: false, error: "A pack is required." }, { status: 400 });
  if (pack.lockHash) return Response.json({ ok: false, error: "A personal study never carries an approval code." }, { status: 400 });
  if (pack.church || pack.churchLogo) return Response.json({ ok: false, error: "A personal study never carries a church name or church logo." }, { status: 400 });
  if ((pack.mode ?? "pastor") !== "member") return Response.json({ ok: false, error: "This pack is not a member pack." }, { status: 400 });
  const parsed = Pack.safeParse(pack);
  if (!parsed.success) return Response.json({ ok: false, error: `Pack does not verify: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ")}` }, { status: 400 });
  let verseStore = {};
  // Nov 11, 2026, v53: the pack's translation picks the store
  // files, so a Spanish personal study verifies against the
  // Spanish store. A legacy pack verifies against BSB.
  const translation = (parsed.data.translation === "rv1909" || parsed.data.translation === "spabes") ? parsed.data.translation : "bsb";
  try {
    // Same store rebuild as the lock route: the pastor-note
    // verse may cite a book outside the pack's five days, so
    // its book joins the store, or a valid note verse would
    // fail verification as an unknown reference.
    const refs = [parsed.data.memoryVerse?.reference, parsed.data.pastorNote?.verse?.reference, ...(parsed.data.adultDevotionals ?? []).map((d) => d.scripture?.reference)].filter(Boolean);
    const books = [...new Set(refs.map((r) => String(r).split(" ")[0]))];
    for (const book of books) {
      const f = path.join(process.cwd(), "data", `${translation}-${book}.json`);
      if (!existsSync(f)) return Response.json({ ok: false, error: `Cannot verify this pack: no verse store for ${book}.` }, { status: 400 });
      Object.assign(verseStore, JSON.parse(readFileSync(f, "utf-8")));
    }
  } catch {
    return Response.json({ ok: false, error: "Cannot verify this pack." }, { status: 400 });
  }
  const verified = verifyPack(parsed.data, verseStore, translation);
  if (!verified.ok) return Response.json({ ok: false, error: `Pack does not verify: ${verified.errors.join(" ")}` }, { status: 400 });
  const entry = {
    id: parsed.data.id, title: parsed.data.title, passage: parsed.data.passage ?? "",
    email: s.email, memberName: parsed.data.memberName, status: "personal",
    savedAt: new Date().toISOString(),
    // A personal study is never locked, whatever the posted
    // status said: the saved pack is a draft, and the entry
    // is personal, so no locked state can be smuggled in.
    pack: { ...parsed.data, status: "draft" },
  };
  saveToLibrary(entry);
  return Response.json({ ok: true, entry });
}
