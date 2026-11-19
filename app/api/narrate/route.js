import { cookies } from "next/headers";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { verifySession, getPastor } from "../../../lib/auth.mjs";

// Nov 11, 2026, v54, Phase 4 audio narration: on-demand
// narration of a draft from the review page. The draft's own
// pastor must be signed in; the audio is written under
// data/narration/<draftId>/, behind sign-in, and never under
// public/. The synthesis runs locally with the Kokoro model
// (sherpa-onnx-node, Apache-2.0); no API key, no network at
// narration time once the model files are on disk. A full
// 5-day pack takes a few minutes on a laptop CPU, so the
// review page says so and waits. Spanish drafts are refused
// here, before the script runs, with the plain reason: the
// voice model has no Spanish pronunciation guide.

const ROOT = process.cwd();
const DRAFTS = path.join(ROOT, "data", "drafts");
const NARRATION = path.join(ROOT, "data", "narration");

function isDraftId(id) {
  return /^job-[0-9a-f]{16}$/.test(String(id ?? ""));
}

function runScript(packPath, outDir, voice) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/narrate-pack.mjs", packPath, outDir, "--voice", voice],
      { cwd: ROOT, timeout: 20 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });
}

export async function GET(request) {
  // Lists the narration already made for a draft, so the
  // review page can show the players again without
  // re-narrating. Same ownership check as the POST.
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const draftId = new URL(request.url).searchParams.get("draftId");
  if (!isDraftId(draftId)) return Response.json({ ok: false, error: "Unknown draft." }, { status: 400 });
  const draftPath = path.join(DRAFTS, `${draftId}.json`);
  if (!existsSync(draftPath)) return Response.json({ ok: false, error: "Unknown draft." }, { status: 404 });
  try {
    const stored = JSON.parse(readFileSync(draftPath, "utf-8"));
    if (stored.email !== s.email) return Response.json({ ok: false, error: "This draft belongs to another account." }, { status: 403 });
  } catch {
    return Response.json({ ok: false, error: "This draft could not be read." }, { status: 400 });
  }
  const manifestPath = path.join(NARRATION, draftId, "manifest.json");
  if (!existsSync(manifestPath)) return Response.json({ ok: true, draftId, files: [] });
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return Response.json({ ok: true, draftId, voice: manifest.voice, files: manifest.files ?? [] });
  } catch {
    return Response.json({ ok: true, draftId, files: [] });
  }
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const draftId = body.draftId;
  if (!isDraftId(draftId)) return Response.json({ ok: false, error: "Unknown draft." }, { status: 400 });
  const draftPath = path.join(DRAFTS, `${draftId}.json`);
  if (!existsSync(draftPath)) return Response.json({ ok: false, error: "Unknown draft." }, { status: 404 });
  let stored;
  try {
    stored = JSON.parse(readFileSync(draftPath, "utf-8"));
  } catch {
    return Response.json({ ok: false, error: "This draft could not be read." }, { status: 400 });
  }
  if (stored.email !== s.email) return Response.json({ ok: false, error: "This draft belongs to another account." }, { status: 403 });
  const pack = stored.draft;
  if (!pack || !Array.isArray(pack.adultDevotionals) || !pack.adultDevotionals.length) {
    return Response.json({ ok: false, error: "This draft has nothing to narrate yet." }, { status: 400 });
  }
  if (String(pack.language ?? "en").toLowerCase() === "es") {
    return Response.json({ ok: false, error: "Spanish narration is not available yet: the voice model has no Spanish pronunciation guide, so Spanish words would come out wrong. English packs narrate today." }, { status: 400 });
  }
  const pastor = getPastor(s.email);
  const voice = pastor?.narrationVoice || "af_heart";
  const outDir = path.join(NARRATION, draftId);
  mkdirSync(outDir, { recursive: true });
  const tmpPack = path.join(outDir, ".pack.json");
  writeFileSync(tmpPack, JSON.stringify(pack));
  const { error, stdout, stderr } = await runScript(tmpPack, outDir, voice);
  try { unlinkSync(tmpPack); } catch {}
  if (error) {
    const detail = (stderr || stdout || error.message || "").slice(-500);
    return Response.json({ ok: false, error: `Narration failed: ${detail}` }, { status: 500 });
  }
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf-8")); } catch {}
  const files = (manifest?.files ?? []).map((f) => ({ day: f.day, kind: f.kind, file: f.file, seconds: f.seconds }));
  if (!files.length) {
    // Fall back to the files on disk if the manifest was not written.
    const onDisk = readdirSync(outDir).filter((n) => n.endsWith(".wav")).sort();
    if (!onDisk.length) return Response.json({ ok: false, error: "Narration finished but wrote no audio." }, { status: 500 });
    return Response.json({ ok: true, draftId, voice, files: onDisk.map((n) => ({ file: n })) });
  }
  return Response.json({ ok: true, draftId, voice, files, manifest });
}
