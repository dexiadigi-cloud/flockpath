import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Nov 11, 2026, v54, Phase 4 local-only analytics: Spiritual
// Pulse-style counts (which passages, themes, and days get
// used), computed on read from the pastor's own local files
// only: the generation jobs in data/generate-jobs and the
// locked library in data/packs-library.json. Nothing is sent
// anywhere, no telemetry, no outside calls, and no separate
// analytics store: the source files are the record, and this
// function only counts them. A pastor sees only their own
// email's packs; a fresh account sees zeros, not someone
// else's counts.

const DATA = path.join(process.cwd(), "data");

function topCounts(counts, n = 5) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function computeAnalytics(email) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const jobs = [];
  const jobsDir = path.join(DATA, "generate-jobs");
  if (existsSync(jobsDir)) {
    for (const name of readdirSync(jobsDir)) {
      if (!name.endsWith(".json") || name.endsWith("-plan.json")) continue;
      try {
        const job = JSON.parse(readFileSync(path.join(jobsDir, name), "utf-8"));
        if (job.email === cleanEmail) jobs.push(job);
      } catch {}
    }
  }
  let library = [];
  try {
    if (existsSync(path.join(DATA, "packs-library.json"))) {
      library = JSON.parse(readFileSync(path.join(DATA, "packs-library.json"), "utf-8"));
    }
  } catch {}
  const mine = (Array.isArray(library) ? library : []).filter((p) => p.email === cleanEmail);

  const lockedPacks = mine.filter((p) => p.status === "locked");
  const personalStudies = mine.filter((p) => p.status === "personal");
  const built = jobs.filter((j) => ["ready_for_review", "done"].includes(j.status)).length;

  const passageCounts = {};
  const topicCounts = {};
  const refCounts = {};
  const hymnCounts = {};
  const dayCounts = {};
  let totalDays = 0;
  for (const p of mine) {
    if (p.passage) passageCounts[p.passage] = (passageCounts[p.passage] ?? 0) + 1;
    for (const t of p.topics ?? []) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    if (p.memoryVerse?.reference) refCounts[p.memoryVerse.reference] = (refCounts[p.memoryVerse.reference] ?? 0) + 1;
    for (const d of p.adultDevotionals ?? []) {
      totalDays += 1;
      if (d.scripture?.reference) refCounts[d.scripture.reference] = (refCounts[d.scripture.reference] ?? 0) + 1;
      if (d.day) dayCounts[d.day] = (dayCounts[d.day] ?? 0) + 1;
    }
    if (p.hymn?.title) hymnCounts[p.hymn.title] = (hymnCounts[p.hymn.title] ?? 0) + 1;
  }
  // Topics ride on jobs, not on locked packs, so a pack built
  // from a topic counts even before it is locked.
  for (const j of jobs) {
    for (const t of j.plan?.topics ?? []) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
  }

  return {
    packsBuilt: built,
    packsLocked: lockedPacks.length,
    personalStudies: personalStudies.length,
    totalDays,
    topPassages: topCounts(passageCounts),
    topTopics: topCounts(topicCounts),
    topVerses: topCounts(refCounts),
    topHymns: topCounts(hymnCounts),
    daysUsed: dayCounts,
    jobsByStatus: jobs.reduce((acc, j) => {
      acc[j.status ?? "unknown"] = (acc[j.status ?? "unknown"] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
