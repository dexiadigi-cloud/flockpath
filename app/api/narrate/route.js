import { cookies } from "next/headers";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { verifySession, getPastor } from "../../../lib/auth.mjs";
import { isNarrationId, narrationDir, narrationStatus, parseSection, plainNarrationError, resolveNarrationSource } from "../../../lib/narration.mjs";

// Nov 11, 2026, v54, Phase 4 audio narration: on-demand
// narration of a draft from the review page. The draft's own
// pastor must be signed in; the audio is written under
// data/narration/<id>/, behind sign-in, and never under
// public/. The synthesis runs locally with the Kokoro model
// (sherpa-onnx-node, Apache-2.0); no API key, no network at
// narration time once the model files are on disk.
// Nov 20, 2026, v62, items 12, 13, 16: narration belongs to
// the PACK, not the review step, so this route now serves a
// draft id or a locked pack id alike (same id space: a pack's
// id is its draft's job id). The POST starts a detached
// background job and returns a job id immediately - no more
// 20-minute blocking request. The GET is the status endpoint
// the UI polls: it reads data/narration/<id>/progress.json
// (written after each file by scripts/narrate-pack.mjs) and
// falls back to counting WAV files on disk when it is absent,
// so a run survives leaving the page and its status is
// readable on return by draft/pack id. A `section` of
// "<day>-<kind>" (e.g. monday-adult) narrates one section
// only, passed through as --section. Spanish packs are
// refused here, before the script runs, with the plain
// reason: the voice model has no Spanish pronunciation guide.

const ROOT = process.cwd();

function session() {
  return cookies().then((store) => verifySession(store.get("flockpath_session")?.value));
}

export async function GET(request) {
  const s = await session();
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get("draftId") || params.get("packId") || params.get("id");
  if (!isNarrationId(id)) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 400 });
  const source = resolveNarrationSource(id, s.email);
  if (!source) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 404 });
  const status = narrationStatus(id);
  return Response.json({
    ok: true, id, draftId: source.kind === "draft" ? id : undefined, packId: source.kind === "pack" ? id : undefined,
    kind: source.kind, title: source.title, date: source.date, language: source.language,
    days: source.days, voice: status.voice, files: status.files,
    status: status.state, done: status.done, total: status.total,
    current: status.current, startedAt: status.startedAt, error: status.error,
    totalSeconds: status.totalSeconds,
  });
}

export async function POST(request) {
  const s = await session();
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = body.draftId || body.packId || body.id;
  if (!isNarrationId(id)) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 400 });
  const source = resolveNarrationSource(id, s.email);
  if (!source) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 404 });
  const pack = source.pack;
  if (!pack || !Array.isArray(pack.adultDevotionals) || !pack.adultDevotionals.length) {
    return Response.json({ ok: false, error: "This pack has nothing to narrate yet." }, { status: 400 });
  }
  if (source.language === "es") {
    return Response.json({ ok: false, error: "Spanish narration is not available yet: the voice model has no Spanish pronunciation guide, so Spanish words would come out wrong. English packs narrate today." }, { status: 400 });
  }
  let section = null;
  if (body.section !== undefined && body.section !== null && String(body.section).trim() !== "") {
    section = parseSection(body.section);
    if (!section) return Response.json({ ok: false, error: "Unknown narration section. Pick one day, adult or kid." }, { status: 400 });
    const dayRow = source.days.find((d) => d.day === section.day);
    if (!dayRow || (section.kind === "kid" && !dayRow.hasKid)) {
      return Response.json({ ok: false, error: `This pack has no ${section.label} section to narrate.` }, { status: 400 });
    }
  }
  const outDir = narrationDir(id);
  mkdirSync(outDir, { recursive: true });
  // A run already in progress keeps the job: starting a
  // second render over it would write the same files twice.
  // The UI polls the running job instead; a finished or
  // failed run clears the way for a re-narration.
  const current = narrationStatus(id);
  if (current.state === "running") {
    return Response.json({ ok: false, error: `Narration is already running for this pack${current.current ? ` (${current.current})` : ""}. Wait for it to finish, then try again.`, jobId: id, status: "running", done: current.done, total: current.total }, { status: 409 });
  }
  const pastor = getPastor(s.email);
  // Nov 21, 2026, v62: fallback is the Liam+Echo blend, the
  // default; getPastor already returns a stored voice for
  // an existing account, so this only fires when there is
  // no stored voice at all.
  const voice = pastor?.narrationVoice || "am_liam_echo";
  const total = section ? 1 : pack.adultDevotionals.length + (pack.kidDevotionals ?? []).filter(Boolean).length;
  const tmpPack = path.join(outDir, ".pack.json");
  writeFileSync(tmpPack, JSON.stringify(pack));
  // The progress file lands BEFORE the child starts, so the
  // first poll already sees a running job with its total.
  // The engine overwrites it after each file lands, with
  // {status, done, total, current, startedAt, error}.
  writeFileSync(path.join(outDir, "progress.json"), JSON.stringify({
    status: "running", done: 0, total, current: section ? section.label : null,
    startedAt: new Date().toISOString(), error: null,
  }, null, 1));
  const args = ["scripts/narrate-pack.mjs", tmpPack, outDir, "--voice", voice];
  if (section) args.push("--section", `${section.file.replace(/\.wav$/, "")}`);
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: "ignore" });
    child.unref();
  } catch (e) {
    writeFileSync(path.join(outDir, "progress.json"), JSON.stringify({
      status: "error", done: 0, total, current: null,
      startedAt: new Date().toISOString(), error: plainNarrationError(e.message),
    }, null, 1));
    return Response.json({ ok: false, error: "Narration could not start. Try again." }, { status: 500 });
  }
  // The child owns the run from here: it writes progress.json
  // after each file and "done" (or "error", with the plain
  // reason) at the end. This request returns now.
  return Response.json({ ok: true, jobId: id, id, kind: source.kind, status: "running", total, section: section ? section.label : null, voice });
}
