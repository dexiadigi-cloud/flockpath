import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { verifySession, getPastor } from "../../../../lib/auth.mjs";
import { BRIDGE_FORMAT, BRIDGE_VERSION } from "../../../../lib/pack.mjs";
import { expandDraft } from "../../../../lib/generate.mjs";
import { BOOK_NAMES } from "../../../../lib/refs.mjs";

// Nov 11, 2026, v52, Phase 2 member mode: the pastor side of
// the send-to-pastor approval bridge. A pastor uploads the
// draft file a member sent them. The file carries references
// only; this route re-retrieves every Scripture verse from
// the pastor's own BSB store, so no AI-written Scripture can
// cross the bridge, because no Scripture text is ever in the
// file. Any verse text found in the file is discarded, never
// trusted. The result is an ordinary review draft, flagged
// member-submitted, which the pastor reviews and locks or
// rejects like any draft. Only a pastor account can import:
// a member importing a bridge file would only make another
// member draft, which the bridge is not for.
const MAX_BYTES = 1024 * 1024;
const REF_RE = /^[A-Z0-9]+ \d+:\d+(-\d+)?$/;

function badRefs(draft) {
  const refs = [draft.memoryVerse?.reference, draft.pastorNote?.verse?.reference,
    ...(draft.adultDevotionals ?? []).map((d) => d.scripture?.reference)].filter(Boolean);
  if (!refs.length) return "No verse references in this draft.";
  for (const r of refs) {
    if (!REF_RE.test(r)) return `Bad reference in this draft: ${r}.`;
    if (!BOOK_NAMES[String(r).split(" ")[0]]) return `Unknown book in this draft: ${r}.`;
  }
  return null;
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const pastor = getPastor(s.email);
  if (!pastor || pastor.role !== "pastor") return Response.json({ ok: false, error: "Only a pastor account can open a member draft for approval." }, { status: 403 });
  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "That draft file is too large. A Flockpath draft is under 1 MB." }, { status: 400 });
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString("utf-8"));
  } catch {
    return Response.json({ ok: false, error: "That file is not a Flockpath draft. It must be the JSON file a member exported with Send to my pastor." }, { status: 400 });
  }
  if (envelope?.format !== BRIDGE_FORMAT || envelope?.version !== BRIDGE_VERSION) {
    return Response.json({ ok: false, error: "That file is not a Flockpath member draft. It must be the JSON file a member exported with Send to my pastor." }, { status: 400 });
  }
  const submittedBy = String(envelope.submittedBy ?? "").trim();
  if (!submittedBy) return Response.json({ ok: false, error: "That draft file does not say who sent it." }, { status: 400 });
  const bridge = envelope.draft;
  if (!bridge || typeof bridge !== "object") return Response.json({ ok: false, error: "That draft file has no pack in it." }, { status: 400 });
  if ((bridge.mode ?? "pastor") !== "member") return Response.json({ ok: false, error: "That draft file is not a member draft." }, { status: 400 });
  if (!bridge.title?.trim() || !bridge.passage?.trim()) return Response.json({ ok: false, error: "That draft file is missing its title or passage." }, { status: 400 });
  if (!Array.isArray(bridge.adultDevotionals) || !bridge.adultDevotionals.length || bridge.adultDevotionals.length > 7) {
    return Response.json({ ok: false, error: "That draft file does not have 1 to 5 adult devotionals." }, { status: 400 });
  }
  if (!Array.isArray(bridge.kidDevotionals) || bridge.kidDevotionals.length !== bridge.adultDevotionals.length) {
    return Response.json({ ok: false, error: "That draft file's adult and kid devotionals do not match." }, { status: 400 });
  }
  const refError = badRefs(bridge);
  if (refError) return Response.json({ ok: false, error: refError }, { status: 400 });
  // Re-retrieve every verse from the pastor's own store.
  // The file's verse text, if any is smuggled in, is never
  // read: the import draft carries references only, and
  // expandDraft fills text from the store or fails.
  // Nov 11, 2026, v53: the bridge draft carries its
  // language and translation (exportBridgeDraft spreads the
  // pack), so a Spanish member draft re-retrieves from the
  // Spanish store, not BSB. A legacy bridge file with no
  // translation re-retrieves from BSB, as before.
  const translation = (bridge.translation === "rv1909" || bridge.translation === "spabes") ? bridge.translation : "bsb";
  let verseStore = {};
  try {
    const refs = [bridge.memoryVerse?.reference, bridge.pastorNote?.verse?.reference,
      ...bridge.adultDevotionals.map((d) => d.scripture?.reference)].filter(Boolean);
    const books = [...new Set(refs.map((r) => String(r).split(" ")[0]))];
    for (const book of books) {
      const f = path.join(process.cwd(), "data", `${translation}-${book}.json`);
      if (!existsSync(f)) return Response.json({ ok: false, error: `Cannot verify this draft: no verse store for ${book}.` }, { status: 400 });
      Object.assign(verseStore, JSON.parse(readFileSync(f, "utf-8")));
    }
  } catch {
    return Response.json({ ok: false, error: "Cannot verify this draft." }, { status: 400 });
  }
  const importDraft = {
    ...bridge,
    pastorName: s.name,
    church: s.church,
    status: "draft",
  };
  delete importDraft.mode;
  delete importDraft.memberName;
  delete importDraft.lockHash;
  delete importDraft.churchLogo;
  let expanded;
  try {
    expanded = expandDraft(importDraft, verseStore, translation);
  } catch (e) {
    return Response.json({ ok: false, error: `This draft cannot be checked: ${e.message}` }, { status: 400 });
  }
  const id = `job-${randomBytes(8).toString("hex")}`;
  const draftsDir = path.join(process.cwd(), "data", "drafts");
  mkdirSync(draftsDir, { recursive: true });
  writeFileSync(path.join(draftsDir, `${id}.json`), JSON.stringify({
    id, jobId: id.slice(4), email: s.email, pastorName: s.name, church: s.church,
    memberSubmitted: true, submittedBy, createdAt: new Date().toISOString(), draft: expanded,
  }, null, 1));
  writeFileSync(path.join(process.cwd(), "data", `${translation}-${id}-merged.json`), JSON.stringify(verseStore, null, 1));
  return Response.json({ ok: true, draftId: id, submittedBy });
}
