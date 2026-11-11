import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary, getPastor } from "../../lib/auth.mjs";
import { packSlug } from "../../lib/pack.mjs";
import { listDraftsFor } from "../api/drafts/route";
import TraditionSettings from "../../components/TraditionSettings";
import ChurchLogoSettings from "../../components/ChurchLogoSettings";
import PasswordSettings from "../../components/PasswordSettings";
import ModelSettings from "../../components/ModelSettings";

export default async function Packs() {
  const store = await cookies();
  const session = verifySession(store.get("flockpath_session")?.value);
  if (!session) redirect("/signin");
  const packs = loadLibrary().filter((p) => p.email === session.email);
  const drafts = listDraftsFor(session.email);
  // Nov 4, 2026, church logo visibility (Mac test item 7):
  // the logo setting already showed a preview inside its own
  // box, below the fold, which the test run missed. The
  // pastor's own mark now also shows at the top of this
  // page, server-rendered from the pastor row, so there is
  // no fetch delay and nothing to scroll to find.
  const pastor = getPastor(session.email);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>My packs</h1>
      {pastor?.logo && (
        <p>
          Your church logo: <img src={`/api/packs/pdf-file?kind=logo&file=${encodeURIComponent(String(pastor.logo).split("/").pop())}`} alt="Your church logo" style={{ maxWidth: 120, maxHeight: 120, verticalAlign: "middle", marginLeft: 8 }} />
        </p>
      )}
      <p>Signed in as {session.name}, {session.church}. Only your packs are shown here.</p>
      <TraditionSettings />
      <ModelSettings />
      <ChurchLogoSettings />
      <PasswordSettings />
      <p><a href="/review">Back to pastor review</a></p>
      <h2>Drafts awaiting your review</h2>
      {drafts.length === 0 ? (
        <p>No drafts awaiting review. A finished generation job appears here as a draft, never as a locked pack, until you approve it.</p>
      ) : (
        <ul>
          {drafts.map((d) => (
            <li key={d.id} style={{ marginBottom: 16 }}>
              <strong>{d.title}</strong> - {d.passage} - draft, not published
              <br />
              <a href={`/review?draft=${d.id}`}>Review and approve this draft</a>
            </li>
          ))}
        </ul>
      )}
      <h2>Locked packs</h2>
      {packs.length === 0 ? (
        <p>No packs yet. Lock a pack from the review page and it will save itself here.</p>
      ) : (
        <ul>
          {packs.map((p) => {
            // Nov 5, 2026, round-2: a locked pack now offers
            // its print PDF right here, through the
            // file-serving route, never a static public/
            // URL. The link shows only when the file
            // actually exists, same gate as the share page.
            const candidates = p.id === "generated-genesis-1"
              ? ["pack-generated-genesis-1.pdf"]
              : [`pack-${p.id}.pdf`, `pack-job-${p.id.replace(/^job-/, "")}.pdf`];
            const hasPdf = p.status === "locked" && candidates.some((c) => existsSync(path.join(process.cwd(), "public", c)));
            return (
              <li key={`${p.id}-${p.savedAt}`} style={{ marginBottom: 16 }}>
                <strong>{p.title}</strong> - {p.passage} - {p.status}
                <br />
                Approval code: <code>{p.lockHash ? p.lockHash.slice(0, 12) + "..." : "none"}</code>
                <br />
                {p.status === "locked" && <a href={`/pack/${packSlug(p.pack ?? p, p.id)}`}>Open share page</a>}
                {hasPdf && <> | <a href={`/api/packs/pdf-file?id=${encodeURIComponent(p.id)}`}>Download print PDF</a></>}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
