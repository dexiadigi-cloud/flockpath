import { cookies } from "next/headers";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";

// Nov 1, 2026, review-before-lock: drafts awaiting pastor
// review. A draft is never a locked pack, never a share page,
// and never a PDF. It becomes a pack only when its pastor
// taps Approve and Lock on the review page.
// GET ?id= returns one draft plus its merged verse store, so
// the review page can refill Scripture text when a reference
// changes, without trusting text typed by anyone.
// DELETE ?id= removes a draft after it has been locked, so a
// locked pack does not linger as pending review.
const DRAFTS = path.join(process.cwd(), "data", "drafts");

function draftPath(id) {
  return path.join(DRAFTS, `${id}.json`);
}

export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^job-[a-f0-9]{16}$/.test(id)) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  if (!existsSync(draftPath(id))) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  const record = JSON.parse(readFileSync(draftPath(id), "utf-8"));
  if (record.email !== s.email) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  // Nov 1, 2026, BSB migration: new jobs write bsb-<id>-merged.json.
  // Fall back to the old engwebp merged file only for drafts
  // created before the migration, so they can still be reviewed.
  // Nov 11, 2026, v53: a Spanish draft's merged store is
  // named for its translation (rv1909-<id>-merged.json or
  // spabes-<id>-merged.json). The draft's own translation
  // picks the file; a legacy draft with no translation falls
  // back to bsb, as before.
  const _tr = record.draft?.translation ?? "bsb";
  const translation = (_tr === "rv1909" || _tr === "spabes") ? _tr : "bsb";
  const mergedName = `${translation}-${id}-merged.json`;
  const mergedPath = path.join(process.cwd(), "data", mergedName);
  const legacyPath = path.join(process.cwd(), "data", `engwebp-${id}-merged.json`);
  const verseStore = existsSync(mergedPath) ? JSON.parse(readFileSync(mergedPath, "utf-8")) : (existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, "utf-8")) : {});
  // Nov 11, 2026, v52: a member-submitted draft carries its
  // flag and the member's name, so the review page can say
  // who sent it and the pastor can judge it as a submission.
  return Response.json({ ok: true, draft: record.draft, verseStore, memberSubmitted: Boolean(record.memberSubmitted), submittedBy: record.submittedBy ?? "" });
}

export async function DELETE(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^job-[a-f0-9]{16}$/.test(id)) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  if (!existsSync(draftPath(id))) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  const record = JSON.parse(readFileSync(draftPath(id), "utf-8"));
  if (record.email !== s.email) return Response.json({ ok: false, error: "Draft not found." }, { status: 404 });
  unlinkSync(draftPath(id));
  return Response.json({ ok: true });
}

export function listDraftsFor(email) {
  if (!existsSync(DRAFTS)) return [];
  return readdirSync(DRAFTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(DRAFTS, f), "utf-8")))
    .filter((r) => r.email === email)
    .map((r) => ({ id: r.id, title: r.draft.title, passage: r.draft.passage, createdAt: r.createdAt, memberSubmitted: Boolean(r.memberSubmitted), submittedBy: r.submittedBy ?? "" }));
}
