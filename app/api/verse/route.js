import { cookies } from "next/headers";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";
import { BOOK_NAMES } from "../../../lib/refs.mjs";

// Nov 5, 2026, round-3 cover note: the review page resolves
// a verse the pastor typed for his cover note, filling the
// exact BSB text from the store, never from typed text.
// GET /api/verse?ref=JAS 1:4, session-authed. The ref must
// be a code reference (the review page parses plain words
// like "James 1:4" into codes first). A verse outside the
// pack's five days still resolves here, because the store
// files cover all 66 books.
export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const ref = (new URL(request.url).searchParams.get("ref") ?? "").trim();
  const m = ref.match(/^([A-Z0-9]+) (\d+:\d+)$/);
  if (!m || !BOOK_NAMES[m[1]]) {
    return Response.json({ ok: false, error: "That verse reference was not recognized. Use a book and chapter and verse, like James 1:4." }, { status: 400 });
  }
  const f = path.join(process.cwd(), "data", `bsb-${m[1]}.json`);
  if (!existsSync(f)) return Response.json({ ok: false, error: "No verse store for that book." }, { status: 404 });
  let book;
  try {
    book = JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return Response.json({ ok: false, error: "Could not read the verse store." }, { status: 500 });
  }
  const text = book[ref];
  if (text === undefined) {
    return Response.json({ ok: false, error: "That verse was not found. Check the chapter and verse." }, { status: 404 });
  }
  return Response.json({ ok: true, reference: ref, text });
}
