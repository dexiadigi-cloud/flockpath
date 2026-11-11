import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { verifySession, loadLibrary } from "../../../../lib/auth.mjs";
import { pdfFileName } from "../../../../lib/pack.mjs";

// Nov 5, 2026, round-2 fix for the share-page PDF 404:
// the production server snapshots public/ at startup, so
// any PDF built while the server runs (every lock-step
// build and every retry) 404s through a static public/
// link until the next restart, even though the file sits
// in public/ and the share page correctly renders the
// link. This route reads the file from disk on every
// request, so a PDF downloads the moment it exists, with
// no restart. Same fix covers church logos uploaded
// mid-session, which hit the same snapshot bug. All PDF
// and logo links in the app now point here, never at a
// static public/ URL for a file created at runtime.
//
// kind=pdf (default): id must be a locked pack in the
// library, which is already public through its share
// page, so no session is required. The file is
// pack-<id>.pdf, then the legacy pack-job-<id>.pdf.
// kind=logo: file must be a plain image name inside
// public/church-logos only, never a path. Both kinds
// reject anything that is not a safe name, so no other
// file on disk can be reached through this route.
// A missing file never falls through to the global
// not-found page: it returns a plain page that says the
// PDF is not ready yet and links back to the pack page,
// where the signed-in owner finds the rebuild button.
const SAFE_ID = /^[A-Za-z0-9-]+$/;
const SAFE_LOGO = /^[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/i;

function missingPage(packId, isOwner) {
  const back = packId ? `<p><a href="/pack/${packId}">Back to the pack page</a></p>` : "";
  const ownerNote = isOwner
    ? "<p>If you are the pastor for this pack, the pack page has a button to rebuild the print PDF.</p>"
    : "<p>Ask the pastor for this pack to rebuild it from the pack page.</p>";
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print PDF not ready</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px">` +
      `<h1>Print PDF not ready yet</h1>` +
      `<p>This pack's print PDF is not ready yet. It may still be building, or the build may have failed.</p>` +
      ownerNote + back + `</body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "pdf";
  const root = process.cwd();

  if (kind === "logo") {
    const file = url.searchParams.get("file") ?? "";
    if (!SAFE_LOGO.test(file)) return new Response("Not found.", { status: 404 });
    const full = path.join(root, "public", "church-logos", file);
    if (!existsSync(full)) return new Response("Not found.", { status: 404 });
    const ext = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(readFileSync(full), { headers: { "Content-Type": ext, "Cache-Control": "private, no-cache" } });
  }

  if (kind !== "pdf") return new Response("Not found.", { status: 404 });
  const id = url.searchParams.get("id") ?? "";
  if (!SAFE_ID.test(id)) return new Response("Not found.", { status: 404 });
  let isOwner = false;
  try {
    const store = await cookies();
    const s = verifySession(store.get("flockpath_session")?.value);
    if (s) {
      const entry = loadLibrary().find((e) => e.id === id);
      isOwner = Boolean(entry && entry.email === s.email);
    }
  } catch { isOwner = false; }
  const entry = (() => {
    try { return loadLibrary().find((e) => e.id === id); } catch { return undefined; }
  })();
  // Mirror the share page: the Genesis demo pack renders
  // even without a library entry, so its PDF must serve
  // the same way. Every other id needs its library entry.
  if (!entry?.pack && id !== "generated-genesis-1") return missingPage(id, isOwner);
  const candidates = id === "generated-genesis-1"
    ? ["pack-generated-genesis-1.pdf"]
    : [`pack-${id}.pdf`, `pack-job-${id.replace(/^job-/, "")}.pdf`];
  const found = candidates.find((c) => existsSync(path.join(root, "public", c)));
  if (!found) return missingPage(id, isOwner);
  // v27, Nov 5, 2026, Jeremiah's PDF naming: the download
  // carries the pastor's title and church plus the job
  // number, so a member knows what the file is. The file
  // on disk keeps its internal name, so PDFs already built
  // keep working. The Genesis demo has no library entry,
  // so its title and church come from the canonical lock.
  let downloadName = found;
  try {
    const pack = entry?.pack ?? (id === "generated-genesis-1" ? JSON.parse(readFileSync(path.join(root, "data", "locked-pack.json"), "utf-8")) : null);
    if (pack?.title) downloadName = pdfFileName(pack, id);
  } catch {}
  return new Response(readFileSync(path.join(root, "public", found)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
