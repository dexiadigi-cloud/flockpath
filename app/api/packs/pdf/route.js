import { cookies } from "next/headers";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary } from "../../../../lib/auth.mjs";

const run = promisify(execFile);

// Nov 2, 2026, pastor-test fix: locking used to save a pack
// to the library with no PDF, so the pack page showed no
// download link for a newly locked pack. This route builds
// that pack's PDF, on demand, from the locked pack in the
// library, never from the canonical Genesis file. It is
// session-gated and only serves packs belonging to the
// signed-in pastor. A PDF failure never un-locks a pack:
// the route reports it, and the review page can retry it.
export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ ok: false, error: "Pack id required." }, { status: 400 });
  const entry = loadLibrary().find((e) => e.id === id && e.email === s.email);
  if (!entry?.pack) return Response.json({ ok: false, error: "Locked pack not found in your library." }, { status: 404 });
  try {
    const root = process.cwd();
    const tmpDir = path.join(root, "data", "packs-pdf");
    mkdirSync(tmpDir, { recursive: true });
    const packFile = path.join(tmpDir, `${id}.json`);
    writeFileSync(packFile, JSON.stringify(entry.pack, null, 1));
    const pdfFile = path.join(root, "public", `pack-${id}.pdf`);
    // Nov 3, 2026, agent-test improvement I4: the temp pack
    // JSON used to stay in data/packs-pdf/ after every build
    // and accumulate. It is deleted once the build no longer
    // needs it, success or failure.
    try {
      await run("node", ["scripts/build-pdf.mjs", packFile, pdfFile], { cwd: root, timeout: 120000 });
    } finally {
      try { unlinkSync(packFile); } catch {}
    }
    // Nov 5, 2026, round-2 PDF fix: the caller used to get
    // a static public/ URL, which 404s for any PDF built
    // while the server runs (the server snapshots public/
    // at startup). It now gets the file-serving route,
    // which reads the file from disk and downloads it
    // with no restart.
    return Response.json({ ok: true, pdf: `/api/packs/pdf-file?id=${encodeURIComponent(id)}` });
  } catch (e) {
    // Nov 4, 2026, logging (Mac test items 28, 30): the
    // old catch returned the error to the caller and wrote
    // it nowhere, so a failed build left no trace in the
    // app log. Log it here, so the failure lands in
    // data/logs/app-<date>.log, where collect-logs finds
    // it. The caller still gets the detail; the pack page
    // retry button shows it to the pastor now.
    console.error(`PDF build failed for pack ${id}:`, e);
    return Response.json({ ok: false, error: `PDF build failed: ${String(e.message || e).slice(0, 200)}` }, { status: 500 });
  }
}
