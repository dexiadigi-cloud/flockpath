import QRCode from "qrcode";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { headers, cookies } from "next/headers";
import { notFound } from "next/navigation";
import lockedPackGenesis from "../../../data/locked-pack.json";
import ShareCopy from "../../../components/ShareCopy";
import PdfRetryButton from "../../../components/PdfRetryButton";
import { verifySession, loadLibrary } from "../../../lib/auth.mjs";
import { matchColoring, COLORING_TEMPLATES } from "../../../lib/coloring.mjs";
import { formatRef } from "../../../lib/refs.mjs";
import { packSlug, resolvePackId } from "../../../lib/pack.mjs";

// Step 6 public share page, updated in Step 7.5 Phase A.
// This page only ever renders a LOCKED pack. It does not edit,
// does not generate, and does not show a draft.
// Phase A fix: it now renders any locked pack stored in the
// library (full pack, not just a summary), with the Genesis pack
// as fallback. Before this, any second pack linked here and
// showed "Pack not found".
function findPack(id) {
  // v28, Nov 5, 2026: the share link carries the friendly
  // slug (title + church + job number), so the id in the
  // URL may be a slug, not the raw pack id. Resolve it
  // back to the real id before looking the pack up, so a
  // slug URL and a plain id URL both open the same pack.
  const realId = resolvePackId(id);
  const libPath = path.join(process.cwd(), "data", "packs-library.json");
  try {
    if (existsSync(libPath)) {
      const lib = JSON.parse(readFileSync(libPath, "utf-8"));
      const entry = lib.find((e) => e.id === realId);
      if (entry?.pack) return entry.pack;
      if (entry && realId === lockedPackGenesis.id) return lockedPackGenesis;
    }
  } catch { /* fall through to Genesis fallback */ }
  if (realId === lockedPackGenesis.id) return lockedPackGenesis;
  return null;
}

export default async function SharePage({ params }) {
  const { id } = await params;
  const lockedPack = findPack(id);
  if (!lockedPack) notFound();
  // Nov 3, 2026, agent-test fix B1: the share link used to
  // default to flockpath.si, but the live site is the
  // informational static site, not the app, so every share
  // link 404d. The local app now builds the link from the
  // request host (the pastor's own computer), unless a site
  // URL is deliberately configured. The copy below says so
  // plainly, so no one mistakes a local link for a hosted one.
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const shareBase = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "") || (host ? `${proto}://${host}` : "https://www.flockpath.si");
  // v28, Nov 5, 2026: the share link carries the same
  // friendly name as the PDF (title + church + job
  // number), so a member knows what the link is and it
  // matches the PDF. The QR code is built from this URL,
  // so it points at the friendly link too.
  const shareUrl = `${shareBase}/pack/${packSlug(lockedPack, lockedPack.id)}`;
  const qr = await QRCode.toDataURL(shareUrl, { margin: 1, width: 300 });
  // Nov 1, 2026, worker step: a pack gets a PDF link only if its
  // own PDF file actually exists in public/. Genesis
  // keeps its existing file; worker packs are pack-job-<id>.pdf.
  // No link is shown for a pack with no PDF file, never a guess.
  // Fixed Nov 1, 2026, after a worker-pack test: the first
  // version checked the Genesis file first, so every pack got
  // the Genesis PDF link. Now a pack gets only its own file.
  // Nov 2, 2026, pastor-test fix: newly locked packs get
  // pack-<id>.pdf from the lock step, so check that first,
  // then the legacy worker file, then the Genesis file.
  const candidates = lockedPack.id === "generated-genesis-1"
    ? ["/pack-generated-genesis-1.pdf"]
    : [`/pack-${lockedPack.id}.pdf`, `/pack-job-${lockedPack.id.replace(/^job-/, "")}.pdf`];
  // Nov 5, 2026, round-2 PDF fix: the file existing is
  // still the gate for showing the link, but the link
  // itself is the file-serving route, never a static
  // public/ URL. Static links 404 for any PDF built
  // while the server runs, because the production server
  // snapshots public/ at startup; the route reads the
  // file from disk and downloads it with no restart.
  const pdfFile = candidates.find((c) => existsSync(path.join(process.cwd(), "public", c.slice(1)))) ?? null;
  const pdfHref = pdfFile ? `/api/packs/pdf-file?id=${encodeURIComponent(lockedPack.id)}` : null;
  // Nov 4, 2026, PDF retry (Mac test items 25, 27): the
  // retry button is a pastor action, so it shows only to
  // the signed-in owner of this pack. A family member
  // viewing the share page sees no button and no dead end:
  // they get the PDF from the pastor, not from here.
  // Nov 5, 2026, round-2 coloring fix: the share page
  // used to re-run the matcher for the image while taking
  // the title and description from the stored pick, so a
  // pastor-picked dove showed a cross. Now the stored
  // pick wins here exactly as it does in review and the
  // PDF, with the matcher only as fallback.
  const coloringId = lockedPack.coloring
    ? (COLORING_TEMPLATES[lockedPack.coloring.svgTemplateId] ? lockedPack.coloring.svgTemplateId : matchColoring(lockedPack))
    : null;
  let isOwner = false;
  try {
    const store = await cookies();
    const s = verifySession(store.get("flockpath_session")?.value);
    if (s) {
      const entry = loadLibrary().find((e) => e.id === lockedPack.id);
      isOwner = Boolean(entry && entry.email === s.email);
    }
  } catch { isOwner = false; }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>{lockedPack.title}</h1>
      <p>{lockedPack.passage} - a week of family discipleship</p>
      <p><strong>Memory verse: {formatRef(lockedPack.memoryVerse.reference)}</strong><br />&ldquo;{lockedPack.memoryVerse.text}&rdquo;</p>
      <p>Approved by {lockedPack.pastorName}, {lockedPack.church}</p>
      <p>Share link: <code>{shareUrl}</code></p>
      <p>This link opens the share page on the computer running Flockpath. To reach family members anywhere, send the print PDF.</p>
      <img src={qr} alt="QR code for this pack's share link" width={200} height={200} />
      <p>This code opens this share page. The print PDF carries no QR code.</p>
      {pdfHref && <p><a href={pdfHref}>Download print PDF (Letter)</a></p>}
      {!pdfHref && isOwner && <PdfRetryButton packId={lockedPack.id} />}
      <ShareCopy title={lockedPack.title} passage={lockedPack.passage} pastorName={lockedPack.pastorName} church={lockedPack.church} shareUrl={shareUrl} />
      {lockedPack.adultDevotionals.map((a, i) => {
        const k = lockedPack.kidDevotionals[i];
        return (
          <section key={a.day} style={{ borderTop: "1px solid #ddd", paddingTop: 16 }}>
            <h2>{a.day}: {a.title}</h2>
            <p><em>{formatRef(a.scripture.reference)}: &ldquo;{a.scripture.text}&rdquo;</em></p>
            <p>{a.body}</p>
            <p><em>Prayer:</em> {a.prayer}</p>
            <h3>For kids: {k.title}</h3>
            <p>{k.retelling}</p>
            <p><em>Activity:</em> {k.activity}</p>
          </section>
        );
      })}
      {lockedPack.leaderQuestions?.length ? (<><h2>Small-group questions</h2><ol>{lockedPack.leaderQuestions.map((q, i) => <li key={i}>{q.question}</li>)}</ol><p>Leader notes and the reading verse are in the print PDF.</p></>) : null}
      {lockedPack.classicDevotional ? (
        <>
          <h2>Classic devotional: {lockedPack.classicDevotional.title}</h2>
          <p>&ldquo;{lockedPack.classicDevotional.excerpt}&rdquo;</p>
          <p>{lockedPack.classicDevotional.workTitle ? <>From {lockedPack.classicDevotional.workTitle}{lockedPack.classicDevotional.tradition_label ? ` (${lockedPack.classicDevotional.tradition_label})` : ""}.</> : "From a public-domain classic devotional."}</p>
        </>
      ) : null}
      {lockedPack.coloring ? (<><h2>Coloring: {lockedPack.coloring.title.replace(/ Coloring$/, "")}</h2><p>{lockedPack.coloring.description}</p><img src={`/coloring/${COLORING_TEMPLATES[coloringId].file}`} alt={COLORING_TEMPLATES[coloringId].alt} width={400} style={{ border: "1px solid #ccc", background: "#fff" }} /></>) : null}
      {lockedPack.hymn ? (
        <>
          <h2>Hymn: {lockedPack.hymn.title}</h2>
          <p>Tune: {lockedPack.hymn.tune}, {lockedPack.hymn.tuneComposer}. Words: {lockedPack.hymn.author} ({lockedPack.hymn.authorYears}), {lockedPack.hymn.wordsYear}.</p>
          <p>Public domain in the US. {lockedPack.hymn.sourceNote}</p>
          <p><a href={lockedPack.hymn.sourceUrl}>Hymn source, lyrics, and score on Hymnary</a> - sheet music and audio links are on that source page, not generated here.</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{lockedPack.hymn.lyrics}</pre>
        </>
      ) : lockedPack.chorus ? (
        <>
          <h2>Original chorus: {lockedPack.chorus.title}</h2>
          <p><em>Only shows for a pack locked before original choruses were removed. New packs carry a verified public-domain hymn, or no song.</em></p>
          <p>{lockedPack.chorus.chordPro}</p>
        </>
      ) : null}
      {pdfHref && <p><a href={pdfHref}>Download print PDF (Letter)</a></p>}
      <p style={{ fontSize: 12, color: "#666" }}>Approval code: <code>{lockedPack.lockHash}</code><br />This code proves the pack was approved exactly as printed. If any word changed, the code would change.</p>
    </main>
  );
}
