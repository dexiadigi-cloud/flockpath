import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary, getPastor } from "../../lib/auth.mjs";
import { packSlug } from "../../lib/pack.mjs";
import { computeAnalytics } from "../../lib/analytics.mjs";
import { listDraftsFor } from "../api/drafts/route";
import TraditionSettings from "../../components/TraditionSettings";
import DoctrinalProfile from "../../components/DoctrinalProfile";
import NarrationSettings from "../../components/NarrationSettings";
import ChurchLogoSettings from "../../components/ChurchLogoSettings";
import PasswordSettings from "../../components/PasswordSettings";
import ModelSettings from "../../components/ModelSettings";

export default async function Packs() {
  const store = await cookies();
  const session = verifySession(store.get("flockpath_session")?.value);
  if (!session) redirect("/signin");
  const isMember = session.role === "member";
  const packs = loadLibrary().filter((p) => p.email === session.email);
  // Nov 11, 2026, v52, Phase 2 member mode: the library
  // splits in two. Locked packs are the pastor's church
  // packs, with a share page and an approval code.
  // Personal studies are a member's own studies: no share
  // link, no approval code, no church branding, and a
  // send-to-pastor download instead.
  const lockedPacks = packs.filter((p) => p.status === "locked");
  const personalPacks = packs.filter((p) => p.status === "personal");
  const drafts = listDraftsFor(session.email);
  // Nov 4, 2026, church logo visibility (Mac test item 7):
  // the logo setting already showed a preview inside its own
  // box, below the fold, which the test run missed. The
  // pastor's own mark now also shows at the top of this
  // page, server-rendered from the pastor row, so there is
  // no fetch delay and nothing to scroll to find.
  const pastor = getPastor(session.email);
  // Nov 11, 2026, v54, Phase 4 local-only analytics: counted
  // here, on this page, from the pastor's own local files
  // only. Nothing is sent anywhere, and nothing leaves this
  // computer. "Days built" counts days in saved packs, not
  // days a family finished: this app never sees a family.
  const analytics = computeAnalytics(session.email);
  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  return (
    <main className="fp-main">
      <h1>My packs</h1>
      {!isMember && pastor?.logo && (
        <p>
          Your church logo: <img src={`/api/packs/pdf-file?kind=logo&file=${encodeURIComponent(String(pastor.logo).split("/").pop())}`} alt="Your church logo" style={{ maxWidth: 120, maxHeight: 120, verticalAlign: "middle", marginLeft: 8 }} />
        </p>
      )}
      <p>Signed in as {session.name}{isMember ? " (member)" : `, ${session.church}`}. Only your packs are shown here.</p>

      <section className="fp-card">
        <h2 style={{ marginTop: 0 }}>Your week at a glance</h2>
        <p>Everything here is counted from the packs on this computer only. Nothing is sent anywhere, and nothing leaves this computer.</p>
        <div className="fp-stat-row">
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsBuilt}</div><div className="fp-stat-label">Packs built</div></div>
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsLocked}</div><div className="fp-stat-label">Packs locked</div></div>
          {isMember && <div className="fp-stat"><div className="fp-stat-num">{analytics.personalStudies}</div><div className="fp-stat-label">Personal studies</div></div>}
          <div className="fp-stat"><div className="fp-stat-num">{analytics.totalDays}</div><div className="fp-stat-label">Days built</div></div>
        </div>
        {analytics.topPassages.length ? (<><p><strong>Most-used passages:</strong></p><ul>{analytics.topPassages.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : <p>No passages yet. Build a pack and its passage shows here.</p>}
        {analytics.topTopics.length ? (<><p><strong>Most-used themes:</strong></p><ul>{analytics.topTopics.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {analytics.topVerses.length ? (<><p><strong>Most-used verses:</strong></p><ul>{analytics.topVerses.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {analytics.topHymns.length ? (<><p><strong>Most-used hymns:</strong></p><ul>{analytics.topHymns.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {Object.keys(analytics.daysUsed).length ? (<><p><strong>Days used:</strong></p><ul>{dayOrder.filter((d) => analytics.daysUsed[d]).map((d) => <li key={d}>{d} ({analytics.daysUsed[d]})</li>)}</ul></>) : null}
      </section>

      <h2 id="drafts" className="fp-section-title">Drafts awaiting your review</h2>
      {drafts.length === 0 ? (
        <p>{isMember ? "No drafts awaiting review. A finished build appears here as a draft, never as a saved study, until you review it." : "No drafts awaiting review. A finished generation job appears here as a draft, never as a locked pack, until you approve it."}</p>
      ) : (
        <div className="fp-pack-grid">
          {drafts.map((d) => (
            <div key={d.id} className="fp-pack-card">
              <span><span className="fp-badge fp-badge-draft">Draft</span></span>
              <h3>{d.title}</h3>
              <p className="fp-pack-meta">{d.passage} - draft, not published</p>
              {d.memberSubmitted && <p className="fp-pack-meta">Sent by {d.submittedBy} for your review, from a member&apos;s personal study.</p>}
              <div className="fp-pack-actions"><a href={`/review?draft=${d.id}`}>{isMember ? "Review this draft" : "Review and approve this draft"}</a></div>
            </div>
          ))}
        </div>
      )}

      {!isMember && (
        <>
          <h2 className="fp-section-title">Locked packs</h2>
          {lockedPacks.length === 0 ? (
            <p>No packs yet. Lock a pack from the review page and it will save itself here.</p>
          ) : (
            <div className="fp-pack-grid">
              {lockedPacks.map((p) => {
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
                  <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                    <span><span className="fp-badge fp-badge-locked">Locked</span></span>
                    <h3>{p.title}</h3>
                    <p className="fp-pack-meta">{p.passage}</p>
                    <p className="fp-pack-meta">Approval code: <code>{p.lockHash ? p.lockHash.slice(0, 12) + "..." : "none"}</code></p>
                    <div className="fp-pack-actions">
                      {p.status === "locked" && <a href={`/pack/${packSlug(p.pack ?? p, p.id)}`}>Open share page</a>}
                      {hasPdf && <a href={`/api/packs/pdf-file?id=${encodeURIComponent(p.id)}`}>Download print PDF</a>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <h2 className="fp-section-title">My personal studies</h2>
      {personalPacks.length === 0 ? (
        <p>{isMember ? "No personal studies yet. Save one from the review page and it will save itself here." : "No personal studies. A member account saves its studies here."}</p>
      ) : (
        <div className="fp-pack-grid">
          {personalPacks.map((p) => {
            const candidates = [`pack-${p.id}.pdf`, `pack-job-${p.id.replace(/^job-/, "")}.pdf`];
            const hasPdf = candidates.some((c) => existsSync(path.join(process.cwd(), "public", c)));
            return (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-personal">Personal study, not pastor-approved</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <div className="fp-pack-actions">
                  {hasPdf && <a href={`/api/packs/pdf-file?id=${encodeURIComponent(p.id)}`}>Download print PDF</a>}
                  <a href={`/api/packs/bridge?id=${encodeURIComponent(p.id)}`}>Send to my pastor</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="fp-section-title">Settings</h2>
      <TraditionSettings />
      {!isMember && <DoctrinalProfile />}
      <NarrationSettings />
      <ModelSettings />
      {!isMember && <ChurchLogoSettings />}
      <PasswordSettings />
      <p><a href="/review">{isMember ? "Back to review" : "Back to pastor review"}</a></p>
    </main>
  );
}
