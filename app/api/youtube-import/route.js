import { cookies } from "next/headers";
import { execFile } from "node:child_process";
import path from "node:path";
import { verifySession } from "../../../lib/auth.mjs";

// Nov 11, 2026, v54, Phase 4 YouTube import: fetches the
// words of a YouTube sermon so the pastor can build a pack
// from it, the same as pasting the sermon text by hand.
// Captions first (fast, kilobytes), then a local
// faster-whisper transcription of the audio when the video
// has no captions. The work runs in scripts/youtube_import.py
// under the app's own Python; the transcript comes back in
// the response and is never stored. A full transcription
// takes several minutes for a long sermon on a laptop CPU,
// so the page says so and waits. The bot wall ("Sign in to
// confirm you're not a bot") comes back as bot_wall=true,
// and the page offers the paste-text path instead.

const ROOT = process.cwd();

// The binary is the literal "python3", never a variable or an
// env-var read: the Next.js build's file tracer follows a
// non-literal spawn binary and runs away using gigabytes (v54
// build bisect, Nov 11, 2026: pythonPath(), an inline env read,
// and a module-scope const all OOM-killed the build; the
// literal builds in seconds). At runtime the start script puts
// the app venv first on PATH, so "python3" resolves to the
// venv Python that has yt-dlp and faster-whisper; without the
// start script it is the system python3, and the import script
// reports its own install line when the packages are missing.
function runImport(url, lang) {
  return new Promise((resolve) => {
    execFile(
      "python3",
      ["scripts/youtube_import.py", url, "--lang", lang],
      { cwd: ROOT, timeout: 30 * 60 * 1000, maxBuffer: 100 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const lang = body.language === "es" ? "es" : "en";
  if (!/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?|youtu\.be\/)/.test(url)) {
    return Response.json({ ok: false, error: "That does not look like a YouTube link. Use a watch link (youtube.com/watch?v=...) or a short link (youtu.be/...)." }, { status: 400 });
  }
  const { error, stdout, stderr } = await runImport(url, lang);
  // The script prints one JSON object; take its last line so
  // a stray progress line from yt-dlp can never break the parse.
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let result = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try { result = JSON.parse(lines[i]); break; } catch {}
  }
  if (!result) {
    const detail = (stderr || error?.message || "The import produced no result.").slice(-500);
    return Response.json({ ok: false, error: `YouTube import failed: ${detail}` }, { status: 500 });
  }
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
}
