// Generation step display test, Nov 3, 2026.
// Verifies the /api/generate GET handler merges a pipeline
// progress file into the job, and ignores a corrupt one,
// without running the model: the job is only queued, the
// worker is never started in this test.
// Usage: node scripts/test-progress.mjs http://localhost:PORT
// Exits nonzero on any failed check. Cleans up its own
// throwaway account, job, plan, and progress files.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = process.argv[2] || "http://localhost:3220";
const email = `progresstest${Date.now()}@example.test`;
const password = "progress-test-123";
let cookie = "";
let jobId = "";
let failed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed += 1;
}
async function post(p, body) {
  const res = await fetch(`${base}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res.json();
}
async function get(p) {
  const res = await fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} });
  return res.json();
}
const JOBS = path.join(process.cwd(), "data", "generate-jobs");
try {
  const signup = await post("/api/signin", { email, password, name: "Progress Test", church: "Test Church" });
  check("throwaway signup", signup.ok === true, JSON.stringify(signup).slice(0, 120));
  const queued = await post("/api/generate", {
    passage: "Psalm 23",
    refs: ["PSA 23:1", "PSA 23:2", "PSA 23:3", "PSA 23:4", "PSA 23:6"],
    topics: [],
  });
  check("job queued", queued.ok === true && queued.job?.status === "queued", JSON.stringify(queued).slice(0, 160));
  jobId = queued.job?.id || "";
  const progressPath = path.join(JOBS, `${jobId}-progress.json`);
  writeFileSync(progressPath, JSON.stringify({ step: 6, total: 14, label: "Building Wednesday" }));
  const withProgress = await get(`/api/generate?id=${jobId}`);
  check(
    "progress merged into job",
    withProgress.ok === true && withProgress.job?.progress?.step === 6 && withProgress.job?.progress?.total === 14 && withProgress.job?.progress?.label === "Building Wednesday",
    JSON.stringify(withProgress.job?.progress),
  );
  writeFileSync(progressPath, "not json{");
  const corrupt = await get(`/api/generate?id=${jobId}`);
  check("corrupt progress ignored, no crash", corrupt.ok === true && corrupt.job?.progress === undefined);
} finally {
  try {
    if (jobId) {
      for (const f of [`${jobId}.json`, `${jobId}-plan.json`, `${jobId}-progress.json`]) {
        const p = path.join(JOBS, f);
        if (existsSync(p)) unlinkSync(p);
      }
    }
    const db = new DatabaseSync(path.join(process.cwd(), "data", "auth.db"));
    db.prepare("DELETE FROM sessions WHERE email = ?").run(email);
    db.prepare("DELETE FROM pastors WHERE email = ?").run(email);
    db.close();
  } catch (e) {
    console.log("cleanup warning:", String(e).slice(0, 200));
  }
}
console.log(failed === 0 ? "PROGRESS TEST: all checks passed" : `PROGRESS TEST: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
