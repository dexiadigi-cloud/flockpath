import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary, getPastor } from "../lib/auth.mjs";
import { t, tf } from "../lib/appStrings.mjs";
import { packSlug } from "../lib/pack.mjs";
import { computeAnalytics } from "../lib/analytics.mjs";
import { listDraftsFor } from "../app/api/drafts/route";

// Nov 12, 2026, v55, Step A: the Dashboard (mockup Design 1).
// The root used to redirect straight to Start a pack; a
// returning pastor now lands on their own week: packs still
// building, drafts ready for review, locked packs, and a
// suggested next pack. Nothing here is a gate: any pack can
// start at any time, and a suggested pack is a suggestion,
// never a lock. Sign-in still lands on Start a pack (Nov 4
// decision, unchanged); the Dashboard is the home link.
const SUGGESTED_TOPICS = [
  { topic: "Forgiveness", blurb: "A week on forgiving as we have been forgiven." },
  { topic: "The Power of the Cross", blurb: "What Jesus finished on the cross, day by day." },
  { topic: "Psalm 23", blurb: "The Lord is my shepherd, one verse a day." },
  { topic: "Grace Upon Grace", blurb: "Grace that keeps giving, from John 1." },
  { topic: "Walking in Love", blurb: "Love in action, from Ephesians 5." },
];

function greetingFor(date, appLanguage) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(date));
  if (hour < 12) return t(appLanguage, "home.morning");
  if (hour < 17) return t(appLanguage, "home.afternoon");
  return t(appLanguage, "home.evening");
}

function listJobsFor(email) {
  const jobsDir = path.join(process.cwd(), "data", "generate-jobs");
  if (!existsSync(jobsDir)) return [];
  const jobs = [];
  for (const name of readdirSync(jobsDir)) {
    if (!name.endsWith(".json") || name.endsWith("-plan.json")) continue;
    try {
      const job = JSON.parse(readFileSync(path.join(jobsDir, name), "utf-8"));
      if (job.email === email) jobs.push(job);
    } catch { /* a half-written job file is skipped, not fatal */ }
  }
  return jobs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

export default async function Home() {
  const store = await cookies();
  const session = verifySession(store.get("flockpath_session")?.value);
  if (!session) redirect("/signin");
  const isMember = session.role === "member";
  const packs = loadLibrary().filter((p) => p.email === session.email);
  const lockedPacks = packs.filter((p) => p.status === "locked");
  const personalPacks = packs.filter((p) => p.status === "personal");
  const drafts = listDraftsFor(session.email);
  const jobs = listJobsFor(session.email);
  const activeJobs = jobs.filter((j) => ["queued", "running"].includes(j.status));
  const stoppedJobs = jobs.filter((j) => j.status === "failed");
  const analytics = computeAnalytics(session.email);
  // Nov 20, 2026, v62 (item 1): the dashboard headings render in
  // the signed-in pastor's app language, server-side.
  const appLanguage = getPastor(session.email)?.appLanguage || "en";
  const greeting = greetingFor(new Date(), appLanguage);

  const builtTitles = packs.map((p) => `${p.title ?? ""} ${p.passage ?? ""}`.toLowerCase());
  // Nov 12, 2026, v55: a topic with a draft still awaiting
  // review is not suggested again - the pastor already has
  // that pack waiting. Suggestions stay suggestions, never a gate.
  const draftTitles = drafts.map((d) => `${d.title ?? ""} ${d.passage ?? ""}`.toLowerCase());
  const suggested = SUGGESTED_TOPICS.filter((s) => ![...builtTitles, ...draftTitles].some((t) => t.includes(s.topic.toLowerCase()))).slice(0, 3);
  const nothingYet = !activeJobs.length && !stoppedJobs.length && !drafts.length && !packs.length;

  return (
    <main className="fp-main">
      <h1>{greeting}, {session.name}</h1>
      <p>{isMember ? t(appLanguage, "home.introStudies") : t(appLanguage, "home.introPacks")}</p>

      {nothingYet && (
        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>{t(appLanguage, "home.startFirst")}</h2>
          <p>{t(appLanguage, "home.startFirstBody")}</p>
          <p><a href="/input" className="fp-btn-gold" style={{ display: "inline-block", padding: "10px 18px", borderRadius: 10, color: "#fff", textDecoration: "none", fontWeight: 700 }}>{t(appLanguage, "home.startPack")}</a></p>
          <p className="fp-muted">{t(appLanguage, "home.costLine")}</p>
        </section>
      )}

      {activeJobs.length > 0 && (
        <section>
          <h2 className="fp-section-title">{t(appLanguage, "home.stillBuilding")}</h2>
          <div className="fp-pack-grid">
            {activeJobs.map((j) => (
              <div key={j.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-building">{t(appLanguage, "home.badgeBuilding")}</span></span>
                <h3>{j.plan?.passage || t(appLanguage, "home.untitledPack")}</h3>
                <p className="fp-pack-meta">{j.progress ? tf(appLanguage, "home.jobStep", { step: j.progress.step, total: j.progress.total, label: j.progress.label }) : t(appLanguage, "input.jobWaiting")}</p>
                <div className="fp-pack-actions"><a href={`/input?job=${encodeURIComponent(j.id)}`}>{t(appLanguage, "home.openBuildPage")}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stoppedJobs.length > 0 && (
        <section>
          <h2 className="fp-section-title">{t(appLanguage, "home.stoppedBuilds")}</h2>
          <div className="fp-pack-grid">
            {stoppedJobs.slice(0, 3).map((j) => (
              <div key={j.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-draft">{t(appLanguage, "home.badgeStopped")}</span></span>
                <h3>{j.plan?.passage || t(appLanguage, "home.untitledPack")}</h3>
                <p className="fp-pack-meta">{t(appLanguage, "home.stoppedNote")}</p>
                <div className="fp-pack-actions"><a href={`/input?job=${encodeURIComponent(j.id)}`}>{t(appLanguage, "home.continueBuild")}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section>
          <h2 className="fp-section-title">{t(appLanguage, "home.readyReview")}</h2>
          <div className="fp-pack-grid">
            {drafts.map((d) => (
              <div key={d.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-draft">{t(appLanguage, "packs.badgeDraft")}</span></span>
                <h3>{d.title}</h3>
                <p className="fp-pack-meta">{tf(appLanguage, "packs.draftMeta", { passage: d.passage })}</p>
                {d.memberSubmitted && <p className="fp-pack-meta">{tf(appLanguage, "review.sentBy", { name: d.submittedBy })}</p>}
                <div className="fp-pack-actions"><a href={`/review?draft=${d.id}`}>{isMember ? t(appLanguage, "input.reviewStudy") : t(appLanguage, "input.reviewDraft")}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isMember && lockedPacks.length > 0 && (
        <section>
          <h2 className="fp-section-title">{t(appLanguage, "home.lockedPacks")}</h2>
          <div className="fp-pack-grid">
            {lockedPacks.slice(0, 3).map((p) => (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-locked">{t(appLanguage, "packs.badgeLocked")}</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <div className="fp-pack-actions">
                  <a href={`/pack/${packSlug(p.pack ?? p, p.id)}`}>{t(appLanguage, "packs.openShare")}</a>
                  <a href="/packs">{t(appLanguage, "home.allPacks")}</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isMember && personalPacks.length > 0 && (
        <section>
          <h2 className="fp-section-title">{t(appLanguage, "home.personalStudies")}</h2>
          <div className="fp-pack-grid">
            {personalPacks.slice(0, 3).map((p) => (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-personal">{t(appLanguage, "packs.badgePersonal")}</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <div className="fp-pack-actions"><a href="/packs">{t(appLanguage, "home.allStudies")}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {suggested.length > 0 && (
        <section>
          <h2 className="fp-section-title">{isMember ? t(appLanguage, "home.suggestedStudies") : t(appLanguage, "home.suggestedPacks")}</h2>
          <p className="fp-muted">{t(appLanguage, "home.suggestionsNote")}</p>
          <div className="fp-pack-grid">
            {suggested.map((s) => (
              <div key={s.topic} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-suggested">{t(appLanguage, "home.badgeSuggested")}</span></span>
                <h3>{s.topic}</h3>
                <p className="fp-pack-meta">{s.blurb}</p>
                <div className="fp-pack-actions"><a href={`/input?topic=${encodeURIComponent(s.topic)}`}>{isMember ? t(appLanguage, "home.startThisStudy") : t(appLanguage, "home.startThisPack")}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="fp-section-title">{t(appLanguage, "home.weekGlance")}</h2>
        <div className="fp-stat-row">
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsBuilt}</div><div className="fp-stat-label">{t(appLanguage, "packs.statBuilt")}</div></div>
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsLocked}</div><div className="fp-stat-label">{t(appLanguage, "packs.statLocked")}</div></div>
          {isMember && <div className="fp-stat"><div className="fp-stat-num">{analytics.personalStudies}</div><div className="fp-stat-label">{t(appLanguage, "packs.statPersonal")}</div></div>}
          <div className="fp-stat"><div className="fp-stat-num">{analytics.totalDays}</div><div className="fp-stat-label">{t(appLanguage, "packs.statDays")}</div></div>
        </div>
        <p><a href="/packs">{t(appLanguage, "home.seeFullPicture")}</a></p>
      </section>
    </main>
  );
}
