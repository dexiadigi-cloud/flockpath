import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary, getPastor } from "../../lib/auth.mjs";
import { packSlug } from "../../lib/pack.mjs";
import { computeAnalytics } from "../../lib/analytics.mjs";
import { narrationStatus, formatDuration } from "../../lib/narration.mjs";
import { listDraftsFor } from "../api/drafts/route";
import TraditionSettings from "../../components/TraditionSettings";
import AppLanguageSettings from "../../components/AppLanguageSettings";
import { t, tf } from "../../lib/appStrings.mjs";
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
  // Nov 20, 2026, v62 (item 1): the page headings render in the
  // signed-in pastor's app language, server-side.
  const appLanguage = pastor?.appLanguage || "en";
  // Nov 11, 2026, v54, Phase 4 local-only analytics: counted
  // here, on this page, from the pastor's own local files
  // only. Nothing is sent anywhere, and nothing leaves this
  // computer. "Days built" counts days in saved packs, not
  // days a family finished: this app never sees a family.
  const analytics = computeAnalytics(session.email);
  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  // Nov 20, 2026, v62, item 14: audio indicator per pack -
  // has audio / in progress / none - read from the narration
  // folder on disk, so it is always current, never a stored
  // flag that can go stale.
  // Nov 21, 2026, v63: the audio indicator reads in the
  // app language, like the rest of this page.
  const audioLine = (id) => {
    const st = narrationStatus(id);
    if (st.state === "done") return st.files.length === 1
      ? tf(appLanguage, "packs.audioReadyOne", { n: st.files.length, duration: formatDuration(st.totalSeconds) })
      : tf(appLanguage, "packs.audioReadyMany", { n: st.files.length, duration: formatDuration(st.totalSeconds) });
    if (st.state === "running") return tf(appLanguage, "packs.audioRunning", { done: st.done, total: st.total });
    if (st.state === "error") return t(appLanguage, "packs.audioFailed");
    return t(appLanguage, "packs.audioNone");
  };

  return (
    <main className="fp-main">
      <h1>{t(appLanguage, "packs.title")}</h1>
      {!isMember && pastor?.logo && (
        <p>
          {t(appLanguage, "packs.churchLogo")} <img src={`/api/packs/pdf-file?kind=logo&file=${encodeURIComponent(String(pastor.logo).split("/").pop())}`} alt={t(appLanguage, "packs.churchLogoAlt")} style={{ maxWidth: 120, maxHeight: 120, verticalAlign: "middle", marginLeft: 8 }} />
        </p>
      )}
      <p>{tf(appLanguage, "packs.signedIn", { name: session.name, suffix: isMember ? t(appLanguage, "packs.memberSuffix") : `, ${session.church}` })}</p>

      <section className="fp-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "home.weekGlance")}</h2>
        <p>{t(appLanguage, "packs.weekIntro")}</p>
        <div className="fp-stat-row">
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsBuilt}</div><div className="fp-stat-label">{t(appLanguage, "packs.statBuilt")}</div></div>
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsLocked}</div><div className="fp-stat-label">{t(appLanguage, "packs.statLocked")}</div></div>
          {isMember && <div className="fp-stat"><div className="fp-stat-num">{analytics.personalStudies}</div><div className="fp-stat-label">{t(appLanguage, "packs.statPersonal")}</div></div>}
          <div className="fp-stat"><div className="fp-stat-num">{analytics.totalDays}</div><div className="fp-stat-label">{t(appLanguage, "packs.statDays")}</div></div>
        </div>
        {analytics.topPassages.length ? (<><p><strong>{t(appLanguage, "packs.topPassages")}</strong></p><ul>{analytics.topPassages.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : <p>{t(appLanguage, "packs.noPassages")}</p>}
        {analytics.topTopics.length ? (<><p><strong>{t(appLanguage, "packs.topTopics")}</strong></p><ul>{analytics.topTopics.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {analytics.topVerses.length ? (<><p><strong>{t(appLanguage, "packs.topVerses")}</strong></p><ul>{analytics.topVerses.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {analytics.topHymns.length ? (<><p><strong>{t(appLanguage, "packs.topHymns")}</strong></p><ul>{analytics.topHymns.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}</ul></>) : null}
        {Object.keys(analytics.daysUsed).length ? (<><p><strong>{t(appLanguage, "packs.daysUsed")}</strong></p><ul>{dayOrder.filter((d) => analytics.daysUsed[d]).map((d) => <li key={d}>{t(appLanguage, `day.${d.toLowerCase()}`)} ({analytics.daysUsed[d]})</li>)}</ul></>) : null}
      </section>

      <h2 id="drafts" className="fp-section-title">{t(appLanguage, "packs.drafts")}</h2>
      {drafts.length === 0 ? (
        <p>{isMember ? t(appLanguage, "packs.noDraftsMember") : t(appLanguage, "packs.noDrafts")}</p>
      ) : (
        <div className="fp-pack-grid">
          {drafts.map((d) => (
            <div key={d.id} className="fp-pack-card">
              <span><span className="fp-badge fp-badge-draft">{t(appLanguage, "packs.badgeDraft")}</span></span>
              <h3>{d.title}</h3>
              <p className="fp-pack-meta">{tf(appLanguage, "packs.draftMeta", { passage: d.passage })}</p>
              <p className="fp-pack-meta">{audioLine(d.id)}</p>
              {d.memberSubmitted && <p className="fp-pack-meta">{tf(appLanguage, "packs.sentByMember", { name: d.submittedBy })}</p>}
              <div className="fp-pack-actions"><a href={`/review?draft=${d.id}`}>{isMember ? t(appLanguage, "input.reviewStudy") : t(appLanguage, "input.reviewDraft")}</a></div>
            </div>
          ))}
        </div>
      )}

      {!isMember && (
        <>
          <h2 className="fp-section-title">{t(appLanguage, "packs.locked")}</h2>
          {lockedPacks.length === 0 ? (
            <p>{t(appLanguage, "packs.noLocked")}</p>
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
                    <span><span className="fp-badge fp-badge-locked">{t(appLanguage, "packs.badgeLocked")}</span></span>
                    <h3>{p.title}</h3>
                    <p className="fp-pack-meta">{p.passage}</p>
                    <p className="fp-pack-meta">{audioLine(p.id)}</p>
                    <p className="fp-pack-meta">{t(appLanguage, "packs.approvalCode")} <code>{p.lockHash ? p.lockHash.slice(0, 12) + "..." : t(appLanguage, "packs.none")}</code></p>
                    <div className="fp-pack-actions">
                      {p.status === "locked" && <a href={`/pack/${packSlug(p.pack ?? p, p.id)}`}>{t(appLanguage, "packs.openShare")}</a>}
                      {hasPdf && <a href={`/api/packs/pdf-file?id=${encodeURIComponent(p.id)}`}>{t(appLanguage, "packs.downloadPdf")}</a>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <h2 className="fp-section-title">{t(appLanguage, "packs.personal")}</h2>
      {personalPacks.length === 0 ? (
        <p>{isMember ? t(appLanguage, "packs.noPersonalMember") : t(appLanguage, "packs.noPersonal")}</p>
      ) : (
        <div className="fp-pack-grid">
          {personalPacks.map((p) => {
            const candidates = [`pack-${p.id}.pdf`, `pack-job-${p.id.replace(/^job-/, "")}.pdf`];
            const hasPdf = candidates.some((c) => existsSync(path.join(process.cwd(), "public", c)));
            return (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-personal">{t(appLanguage, "packs.badgePersonal")}</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <p className="fp-pack-meta">{audioLine(p.id)}</p>
                <div className="fp-pack-actions">
                  {hasPdf && <a href={`/api/packs/pdf-file?id=${encodeURIComponent(p.id)}`}>{t(appLanguage, "packs.downloadPdf")}</a>}
                  <a href={`/api/packs/bridge?id=${encodeURIComponent(p.id)}`}>{t(appLanguage, "packs.sendToPastor")}</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="fp-section-title">{t(appLanguage, "packs.settings")}</h2>
      <AppLanguageSettings />
      <TraditionSettings />
      {!isMember && <DoctrinalProfile />}
      <NarrationSettings />
      <ModelSettings />
      {!isMember && <ChurchLogoSettings />}
      <PasswordSettings />
      <p><a href="/review">{isMember ? t(appLanguage, "packs.backReview") : t(appLanguage, "packs.backPastorReview")}</a></p>
    </main>
  );
}
