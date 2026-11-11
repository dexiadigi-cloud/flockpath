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
  const bsbPath = path.join(process.cwd(), "data", `bsb-${id}-merged.json`);
  const legacyPath = path.join(process.cwd(), "data", `engwebp-${id}-merged.json`);
  const mergedPath = existsSync(bsbPath) ? bsbPath : legacyPath;
  const verseStore = existsSync(mergedPath) ? JSON.parse(readFileSync(mergedPath, "utf-8")) : {};
  return Response.json({ ok: true, draft: record.draft, verseStore });
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
    .map((r) => ({ id: r.id, title: r.draft.title, passage: r.draft.passage, createdAt: r.createdAt }));
}
