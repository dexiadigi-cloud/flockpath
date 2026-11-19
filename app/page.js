import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifySession, loadLibrary } from "../lib/auth.mjs";
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

function greetingFor(date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(date));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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
  const greeting = greetingFor(new Date());

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
      <p>{isMember ? "Your personal studies, your week at a glance, and your next study." : "Your packs, your week at a glance, and your next pack."}</p>

      {nothingYet && (
        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>Start your first pack</h2>
          <p>Three steps: paste a sermon or a verse list, check the verses, name it and build. Flockpath writes one day at a time, every verse is filled in from the Bible text by code, and nothing locks until you approve it.</p>
          <p><a href="/input" className="fp-btn-gold" style={{ display: "inline-block", padding: "10px 18px", borderRadius: 10, color: "#fff", textDecoration: "none", fontWeight: 700 }}>Start a pack</a></p>
          <p className="fp-muted">About a penny a family per week on OpenRouter, and free on the local model. Flockpath itself is free.</p>
        </section>
      )}

      {activeJobs.length > 0 && (
        <section>
          <h2 className="fp-section-title">Still building</h2>
          <div className="fp-pack-grid">
            {activeJobs.map((j) => (
              <div key={j.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-building">Building</span></span>
                <h3>{j.plan?.passage || "Untitled pack"}</h3>
                <p className="fp-pack-meta">{j.progress ? `Step ${j.progress.step} of ${j.progress.total}: ${j.progress.label}` : "Waiting to start"}</p>
                <div className="fp-pack-actions"><a href={`/input?job=${encodeURIComponent(j.id)}`}>Open the build page</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stoppedJobs.length > 0 && (
        <section>
          <h2 className="fp-section-title">Builds that stopped</h2>
          <div className="fp-pack-grid">
            {stoppedJobs.slice(0, 3).map((j) => (
              <div key={j.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-draft">Stopped</span></span>
                <h3>{j.plan?.passage || "Untitled pack"}</h3>
                <p className="fp-pack-meta">Finished sections are kept. Continue picks up where it left off.</p>
                <div className="fp-pack-actions"><a href={`/input?job=${encodeURIComponent(j.id)}`}>Continue this build</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section>
          <h2 className="fp-section-title">Ready for your review</h2>
          <div className="fp-pack-grid">
            {drafts.map((d) => (
              <div key={d.id} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-draft">Draft</span></span>
                <h3>{d.title}</h3>
                <p className="fp-pack-meta">{d.passage} - draft, not published</p>
                {d.memberSubmitted && <p className="fp-pack-meta">Sent by {d.submittedBy} for your review.</p>}
                <div className="fp-pack-actions"><a href={`/review?draft=${d.id}`}>{isMember ? "Review this draft" : "Review and approve this draft"}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isMember && lockedPacks.length > 0 && (
        <section>
          <h2 className="fp-section-title">Your locked packs</h2>
          <div className="fp-pack-grid">
            {lockedPacks.slice(0, 3).map((p) => (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-locked">Locked</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <div className="fp-pack-actions">
                  <a href={`/pack/${packSlug(p.pack ?? p, p.id)}`}>Open share page</a>
                  <a href="/packs">All packs</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isMember && personalPacks.length > 0 && (
        <section>
          <h2 className="fp-section-title">Your personal studies</h2>
          <div className="fp-pack-grid">
            {personalPacks.slice(0, 3).map((p) => (
              <div key={`${p.id}-${p.savedAt}`} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-personal">Personal study, not pastor-approved</span></span>
                <h3>{p.title}</h3>
                <p className="fp-pack-meta">{p.passage}</p>
                <div className="fp-pack-actions"><a href="/packs">All studies</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {suggested.length > 0 && (
        <section>
          <h2 className="fp-section-title">Suggested next {isMember ? "studies" : "packs"}</h2>
          <p className="fp-muted">Suggestions only. Any pack can start at any time, and nothing is locked behind another pack.</p>
          <div className="fp-pack-grid">
            {suggested.map((s) => (
              <div key={s.topic} className="fp-pack-card">
                <span><span className="fp-badge fp-badge-suggested">Suggested</span></span>
                <h3>{s.topic}</h3>
                <p className="fp-pack-meta">{s.blurb}</p>
                <div className="fp-pack-actions"><a href={`/input?topic=${encodeURIComponent(s.topic)}`}>Start this {isMember ? "study" : "pack"}</a></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="fp-section-title">Your week at a glance</h2>
        <div className="fp-stat-row">
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsBuilt}</div><div className="fp-stat-label">Packs built</div></div>
          <div className="fp-stat"><div className="fp-stat-num">{analytics.packsLocked}</div><div className="fp-stat-label">Packs locked</div></div>
          {isMember && <div className="fp-stat"><div className="fp-stat-num">{analytics.personalStudies}</div><div className="fp-stat-label">Personal studies</div></div>}
          <div className="fp-stat"><div className="fp-stat-num">{analytics.totalDays}</div><div className="fp-stat-label">Days built</div></div>
        </div>
        <p><a href="/packs">See the full picture on My packs</a></p>
      </section>
    </main>
  );
}
