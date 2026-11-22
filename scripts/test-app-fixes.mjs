// Nov 3, 2026, regression test for the independent agent's
// exploratory-test findings (B1-B3, W1-W18, I1-I4).
//
// Usage: start the app first on a test port, then run:
//   node scripts/test-app-fixes.mjs http://localhost:3210
// The script uses ONE throwaway account and deletes every
// trace afterwards (pastor row, sessions, job files, library
// entries for that account, uploaded logo file). It never
// touches the canonical pack or other accounts' data, never
// runs the model or worker, and never clicks Approve and Lock.
//
// Checks are labeled LIVE (real HTTP against the running app)
// or SOURCE (string assertion on the file, for client-side or
// copy-only fixes a curl cannot see). Exit code 0 means every
// check passed; any failure prints FAIL and exits 1.

import { readFileSync, existsSync, unlinkSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runCmd = promisify(execFile);
const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const ROOT = process.cwd();
const EMAIL = "regressiontest@example.church";
const PASS = "regressionpass123";
// Nov 4, 2026, fix-round accounts: a second throwaway
// account exists only to prove the lockout (its correct
// password must fail while locked, so the main account's
// session cannot be used for that check).
const LOCK_EMAIL = "locktest@example.church";
const LOCK_PASS = "locktestpass123";
let builtPdf = false;
let reviewLogCreated = false;
let reviewLogExistedBefore = false;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`); }
}
function srcHas(file, needle, name) {
  try {
    check(name, readFileSync(path.join(ROOT, file), "utf-8").includes(needle));
  } catch (e) { check(name, false, String(e.message)); }
}
function srcNotHas(file, needle, name) {
  try {
    check(name, !readFileSync(path.join(ROOT, file), "utf-8").includes(needle));
  } catch (e) { check(name, false, String(e.message)); }
}
function srcOrder(file, first, second, name) {
  try {
    const src = readFileSync(path.join(ROOT, file), "utf-8");
    const a = src.indexOf(first);
    const b = src.indexOf(second);
    check(name, a !== -1 && b !== -1 && a < b, `positions ${a}, ${b}`);
  } catch (e) { check(name, false, String(e.message)); }
}

// --- tiny cookie jar for fetch ---
let cookie = "";
async function call(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    redirect: "manual",
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, headers: res.headers };
}
async function signin() {
  const r = await call("/api/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, name: "Regression Test", church: "Regression Church", denomination: "non-denominational" }),
  });
  return r.status === 200;
}

const jobIds = [];
const libEntryIds = [];
async function cleanup() {
  // Remove test jobs.
  for (const id of jobIds) {
    for (const suffix of ["", "-plan"]) {
      const f = path.join(ROOT, "data", "generate-jobs", `${id}${suffix}.json`);
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }
  // Remove library entries created by the test account only.
  const libPath = path.join(ROOT, "data", "packs-library.json");
  try {
    const lib = JSON.parse(readFileSync(libPath, "utf-8"));
    const kept = lib.filter((e) => e.email !== EMAIL);
    if (kept.length !== lib.length) writeFileSync(libPath, JSON.stringify(kept, null, 1));
  } catch {}
  // Remove the test pastor rows and sessions, and logo files.
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(ROOT, "data", "auth.db"));
    for (const em of [EMAIL, LOCK_EMAIL]) {
      db.prepare("DELETE FROM sessions WHERE email = ?").run(em);
      db.prepare("DELETE FROM pastors WHERE email = ?").run(em);
    }
    db.close();
  } catch (e) { console.log(`WARN pastor cleanup: ${e.message}`); }
  for (const f of readdirSync(path.join(ROOT, "public", "church-logos"))) {
    if (f.startsWith("regressiontest-example-church.") || f.startsWith("locktest-example-church.")) {
      try { unlinkSync(path.join(ROOT, "public", "church-logos", f)); } catch {}
    }
  }
  // Nov 4, 2026: the PDF this run built, and the review log
  // file this run created, are test artifacts, not app data.
  if (builtPdf) {
    try { unlinkSync(path.join(ROOT, "public", "pack-psa23-baptist.pdf")); } catch {}
  }
  if (reviewLogCreated && !reviewLogExistedBefore) {
    try {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      unlinkSync(path.join(ROOT, "data", "logs", `review-${local}.log`));
    } catch {}
  }
}

try {
  // W12: malformed JSON is 400, wrong password is 401.
  const bad = await fetch(`${BASE}/api/signin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json", redirect: "manual" });
  check("LIVE W12 malformed sign-in JSON returns 400", bad.status === 400, `got ${bad.status}`);
  const okSignin = await signin();
  check("LIVE test account sign-in works", okSignin);
  const wrong = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "wrongpassword1", name: "Regression Test", church: "Regression Church" }) });
  check("LIVE W12 wrong password returns 401", wrong.status === 401, `got ${wrong.status}`);

  // B2: fake locked pack rejected; bad hash rejected; true hash accepted.
  const fake = await call("/api/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "regression-junk", title: "Junk" }) });
  check("LIVE B2 pack with no pack and no hash rejected", fake.status === 400, `got ${fake.status}`);
  const realPack = JSON.parse(readFileSync(path.join(ROOT, "data", "locked-psa23-baptist.json"), "utf-8"));
  const badHash = await call("/api/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: realPack.id, title: realPack.title, passage: realPack.passage, status: "locked", lockHash: "0".repeat(64), pack: realPack }) });
  check("LIVE B2 pack with a forged hash rejected", badHash.status === 400, `got ${badHash.status}`);
  // The true-hash case locks in-process first, exactly as
  // the review page does (lock, then post the result), so
  // the hash is fresh under the current lock function. The
  // stored test pack's own hash predates the Nov 3
  // round-trip-stability fix and is not reused here.
  const { lockPack } = await import(path.join(ROOT, "lib", "pack.mjs"));
  const bsbPsa = JSON.parse(readFileSync(path.join(ROOT, "data", "bsb-PSA.json"), "utf-8"));
  const { lockHash: _oldHash, lockedAt: _oldAt, ...packContent } = realPack;
  const fresh = lockPack(packContent, bsbPsa, "bsb");
  check("LIVE B2 in-process lock of the test pack verifies", fresh.ok, (fresh.errors || []).join(" "));
  const good = fresh.ok ? await call("/api/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: fresh.pack.id, title: fresh.pack.title, passage: fresh.pack.passage, status: "locked", lockHash: fresh.pack.lockHash, pack: fresh.pack }) }) : { status: 0 };
  check("LIVE B2 freshly locked pack with its true hash accepted", good.status === 200, `got ${good.status}`);
  if (good.status === 200) libEntryIds.push(fresh.pack.id);

  // B3: duplicates and unknown book rejected; valid refs accepted.
  const dupes = await call("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passage: "Psalm 23", refs: ["PSA 23:1", "PSA 23:1", "PSA 23:1", "PSA 23:1", "PSA 23:1"], topics: [] }) });
  check("LIVE B3 duplicate refs rejected", dupes.status === 400, `got ${dupes.status}`);
  const unknown = await call("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passage: "Psalm 23", refs: ["PSA 23:1", "PSA 23:2", "PSA 23:3", "PSA 23:4", "XXX 23:1"], topics: [] }) });
  check("LIVE B3 unknown book code rejected", unknown.status === 400, `got ${unknown.status}`);
  const valid = await call("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passage: "Psalm 23", refs: ["PSA 23:1", "PSA 23:2", "PSA 23:3", "PSA 23:4", "PSA 23:6"], topics: [] }) });
  check("LIVE B3 five distinct known refs accepted", valid.status === 200, `got ${valid.status}`);
  if (valid.json?.job?.id) jobIds.push(valid.json.job.id);

  // W18: continuing a merely queued job rejected.
  if (jobIds[0]) {
    const cont = await call("/api/generate/continue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: jobIds[0] }) });
    check("LIVE W18 continuing a queued job rejected", cont.status === 400, `got ${cont.status}`);
  }

  // W13: fake PNG rejected, real PNG accepted then removed.
  const fakePng = new FormData();
  fakePng.append("logo", new Blob(["this is not an image"], { type: "image/png" }), "logo.png");
  const fakeLogo = await call("/api/logo", { method: "POST", body: fakePng });
  check("LIVE W13 non-image renamed to .png rejected", fakeLogo.status === 400, `got ${fakeLogo.status}`);
  const realPng = new FormData();
  realPng.append("logo", new Blob([readFileSync(path.join(ROOT, "public", "church-logos", "sample-church.png"))], { type: "image/png" }), "logo.png");
  const realLogo = await call("/api/logo", { method: "POST", body: realPng });
  check("LIVE W13 real PNG accepted", realLogo.status === 200, `got ${realLogo.status}`);
  // Nov 4, 2026, logo visibility (Mac test item 7): the
  // upload loop was already proven, but the pastor could
  // not see the logo anywhere after signup. Now /api/me
  // reports it and My packs shows it at the top.
  const me = await call("/api/me");
  check("LIVE NOV4 uploaded logo reported by /api/me", Boolean(me.json?.logo), `got ${JSON.stringify(me.json)}`);
  const packsPage = await call("/packs");
  check("LIVE NOV4 My packs shows the logo at the top", packsPage.text.includes("Your church logo:"), "top logo preview missing");
  const removed = await call("/api/logo", { method: "POST", body: (() => { const f = new FormData(); f.append("remove", "1"); return f; })() });
  check("LIVE W13 uploaded logo removed", removed.status === 200, `got ${removed.status}`);

  // I2: fake PDF gets the friendly message, not a raw pypdf line.
  const fakePdf = new FormData();
  fakePdf.append("file", new Blob(["%PDF-1.4 not really a pdf"], { type: "application/pdf" }), "fake.pdf");
  const up = await call("/api/upload", { method: "POST", body: fakePdf });
  check("LIVE I2 fake PDF error is friendly", (up.json?.error || "").includes("not a readable PDF"), `got ${up.json?.error || up.status}`);

  // W17 + B1 + W4/W5/W6/W7/W8: share page behavior.
  const missing = await call("/pack/no-such-pack-xyz");
  check("LIVE W17 nonexistent share page returns 404", missing.status === 404, `got ${missing.status}`);
  const genesis = await call("/pack/generated-genesis-1");
  check("LIVE B1 share page link is local, not flockpath.si", genesis.text.includes("localhost") || genesis.text.includes("127.0.0.1"), "no local host in share link");
  check("LIVE B1 share page does not link flockpath.si/pack", !genesis.text.includes("flockpath.si/pack"), "dead flockpath.si/pack link still present");
  check("LIVE W4 share memory verse is quoted", genesis.text.includes("&ldquo;") || genesis.text.includes("\u201c"), "no curly quotes found");
  check("LIVE W5 share legacy chorus note present", genesis.text.includes("before original choruses were removed"), "legacy note missing");
  check("LIVE W6 share hash carries its proof line", genesis.text.includes("If any word changed, the code would change"), "proof line missing");
  check("LIVE NOV5 share proof line says Approval code", genesis.text.includes("Approval code:"), "Approval code label missing");
  check("LIVE W8 share QR line present", genesis.text.includes("The print PDF carries no QR code"), "QR line missing");
  // W7 is checked on the Psalm 23 test pack (posted to the
  // library by the B2 test above), because the Genesis demo
  // pack predates the classic devotional and has none.
  const psa23 = await call("/pack/psa23-baptist");
  check("LIVE W7 share classic devotional present", psa23.text.includes("Classic devotional"), "classic section missing");

  // Nov 4, 2026, PDF retry (Mac test items 25, 27): the
  // pack posted by the B2 test has no PDF yet, so the retry
  // route must build one, and the pack page must then link
  // it. This also proves the retry path a pastor uses after
  // a failed lock-step build.
  const retry = await call("/api/packs/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "psa23-baptist" }) });
  check("LIVE NOV4 PDF retry route builds the missing PDF", retry.status === 200 && retry.json?.ok === true, `got ${retry.status} ${retry.text.slice(0, 120)}`);
  if (retry.status === 200) builtPdf = true;
  const psa23Pdf = await call("/pack/psa23-baptist");
  check("LIVE NOV4 pack page links the retried PDF", psa23Pdf.text.includes("/api/packs/pdf-file?id=psa23-baptist"), "retried PDF link missing");
  check("LIVE NOV5 pack page does not link the static PDF path", !psa23Pdf.text.includes("/pack-psa23-baptist.pdf"), "static PDF link still present");

  // Nov 5, 2026, round-2 PDF fix: the retry above built
  // the PDF while this server was already running, which
  // is exactly the case that used to 404 through a static
  // public/ link. The file route must serve it with no
  // restart, a missing pack must get the plain not-ready
  // page (never the global not-found page), and unsafe
  // ids must be refused outright.
  const routePdf = await fetch(`${BASE}/api/packs/pdf-file?id=psa23-baptist`, { redirect: "manual" });
  const routePdfText = await routePdf.text();
  check("LIVE NOV5 file route serves the retried PDF with no restart", routePdf.status === 200 && routePdf.headers.get("content-type")?.includes("application/pdf") && routePdfText.startsWith("%PDF-"), `got ${routePdf.status} ${routePdf.headers.get("content-type")}`);
  const routeMissing = await call("/api/packs/pdf-file?id=no-such-pack-xyz");
  check("LIVE NOV5 file route missing pack gets the not-ready page", routeMissing.status === 404 && routeMissing.text.includes("Print PDF not ready"), `got ${routeMissing.status}`);
  check("LIVE NOV5 file route missing pack is not the global not-found", !routeMissing.text.includes("Nothing here. If you followed a pack link"), "global not-found leaked through");
  const routeTraversal = await call("/api/packs/pdf-file?id=..%2F..%2Fsecret");
  check("LIVE NOV5 file route refuses a traversal id", routeTraversal.status === 404, `got ${routeTraversal.status}`);
  const routeLogo = await fetch(`${BASE}/api/packs/pdf-file?kind=logo&file=sample-church.png`, { redirect: "manual" });
  await routeLogo.text();
  check("LIVE NOV5 file route serves a church logo", routeLogo.status === 200 && routeLogo.headers.get("content-type")?.includes("image/png"), `got ${routeLogo.status} ${routeLogo.headers.get("content-type")}`);
  const routeLogoTraversal = await call("/api/packs/pdf-file?kind=logo&file=..%2F..%2Fauth.db");
  check("LIVE NOV5 file route refuses a traversal logo file", routeLogoTraversal.status === 404, `got ${routeLogoTraversal.status}`);

  // Nov 5, 2026, round-2: review lives at /review, and
  // My packs offers the PDF download for a pack that has
  // one. v55: the root is the Dashboard now, it no longer
  // redirects to Start a pack.
  const root = await call("/");
  check("LIVE V55 root renders the Dashboard", root.status === 200 && root.text.includes("Good ") && root.text.includes("Your week at a glance"), `got ${root.status}`);
  const review = await call("/review");
  check("LIVE NOV5 review page renders at /review", review.status === 200 && review.text.includes("Flockpath: pastor review"), `got ${review.status}`);
  check("LIVE NOV5 review page shows the journey strip", review.text.includes("Approve and lock"), "journey strip missing");
  const packsAfterPdf = await call("/packs");
  check("LIVE NOV5 My packs offers the PDF download", packsAfterPdf.text.includes("/api/packs/pdf-file?id=psa23-baptist"), "My packs PDF link missing");

  // Nov 4, 2026, review logging (Mac test items 19, 30):
  // the review page posts full gate detail to the log when
  // the verdict changes; the route must accept it and the
  // line must land in today's review log.
  const reviewLogPath = (() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return path.join(ROOT, "data", "logs", `review-${local}.log`);
  })();
  reviewLogExistedBefore = existsSync(reviewLogPath);
  const rlog = await call("/api/review-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: null, scripture: { ok: true, errors: [] }, quality: { ok: true, issues: [], warnings: [] } }) });
  check("LIVE NOV4 review-log route accepts a verdict", rlog.status === 200 && rlog.json?.ok === true, `got ${rlog.status} ${rlog.text.slice(0, 120)}`);
  if (rlog.status === 200) {
    reviewLogCreated = true;
    let logged = false;
    try { logged = readFileSync(reviewLogPath, "utf-8").includes(EMAIL); } catch {}
    check("LIVE NOV4 review verdict line written to the log", logged, "no line for the test account");
  }

  // Nov 5, 2026, round-3 cover note: the review page
  // resolves the verse a pastor types for his own note
  // through this route, filling exact BSB text. A known
  // verse resolves, an unknown book is a 400, and a verse
  // that does not exist is a 404. Runs before the lockout
  // block, while the cookie jar still holds the main
  // account's session.
  const verseOk = await call("/api/verse?ref=JAS%201%3A4");
  check("LIVE NOV5 verse route resolves a known verse", verseOk.status === 200 && verseOk.json?.text === "Allow perseverance to finish its work, so that you may be mature and complete, not lacking anything.", `got ${verseOk.status} ${verseOk.text.slice(0, 120)}`);
  const verseBook = await call("/api/verse?ref=XXX%201%3A1");
  check("LIVE NOV5 verse route refuses an unknown book", verseBook.status === 400, `got ${verseBook.status}`);
  const verseMissing = await call("/api/verse?ref=JAS%2099%3A99");
  check("LIVE NOV5 verse route reports a missing verse", verseMissing.status === 404, `got ${verseMissing.status}`);

  // Nov 4, 2026, auth lockout + change + local reset (Mac
  // test items 2, 3, 4). A separate account, so the main
  // account's session is untouched by the lock. Runs last
  // among live checks: the cookie jar ends on this account.
  const lockSignin = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOCK_EMAIL, password: LOCK_PASS, name: "Lock Test", church: "Lock Church" }) });
  check("LIVE NOV4 lockout account created", lockSignin.status === 200, `got ${lockSignin.status}`);
  // The sign-in route requires name and church on every
  // call (the form always sends them); the wrong-password
  // calls below include them, or they would 400 on
  // validation instead of exercising the lockout.
  let lockStatus = 0;
  for (let i = 0; i < 5; i++) {
    const w = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOCK_EMAIL, password: "wrongpassword1", name: "Lock Test", church: "Lock Church" }) });
    lockStatus = w.status;
  }
  check("LIVE NOV4 fifth wrong password locks the account (429)", lockStatus === 429, `got ${lockStatus}`);
  const whileLocked = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOCK_EMAIL, password: LOCK_PASS, name: "Lock Test", church: "Lock Church" }) });
  check("LIVE NOV4 correct password still refused while locked", whileLocked.status === 429, `got ${whileLocked.status}`);
  try {
    await runCmd("node", ["scripts/reset-password.mjs", LOCK_EMAIL, "locktestpass456"], { cwd: ROOT });
    check("LIVE NOV4 local reset script runs", true);
  } catch (e) { check("LIVE NOV4 local reset script runs", false, String(e.message).slice(0, 200)); }
  const afterReset = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOCK_EMAIL, password: "locktestpass456", name: "Lock Test", church: "Lock Church" }) });
  check("LIVE NOV4 sign-in works after local reset", afterReset.status === 200, `got ${afterReset.status}`);
  const changed = await call("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: "locktestpass456", newPassword: "locktestpass789" }) });
  check("LIVE NOV4 change password while signed in", changed.status === 200, `got ${changed.status} ${changed.text.slice(0, 120)}`);
  const afterChange = await call("/api/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOCK_EMAIL, password: "locktestpass789", name: "Lock Test", church: "Lock Church" }) });
  check("LIVE NOV4 sign-in works with the changed password", afterChange.status === 200, `got ${afterChange.status}`);

  // SOURCE checks for copy and client-side fixes.
  // Nov 5, 2026, round-3: the Nov 4 Mac speed run finished
  // a full pack in about 3 minutes, so the old "30 to 90
  // minutes" range is gone from user copy; the new wording
  // is "up to 30 minutes, depending on your computer".
  srcHas("components/InputPage.js", '"input.howTime"', "SOURCE NOV5 InputPage time range"); // v63: time wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "up to 30 minutes with the local model on an older computer", "SOURCE NOV5 InputPage time range English kept"); // v63
  srcNotHas("components/InputPage.js", "30 to 90 minutes", "SOURCE NOV5 old time range gone from InputPage");
  // Nov 4, 2026: the walkthrough rewrite reworded these two
  // notes (refs -> passages, reused -> kept) with the meaning
  // unchanged. The needles below assert the current wording.
  srcHas("components/InputPage.js", '"input.ifStopsContinue"', "SOURCE W10 resume wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "finished days and questions are kept", "SOURCE W10 resume wording English kept"); // v63
  // v54: the note is now dynamic (first {dayCount}) so a 3- or
  // 7-day pack reads right; the 5-day wording is unchanged.
  srcHas("components/InputPage.js", '"input.onlyFirst"', "SOURCE I3 first-5 note"); // v63: note moved to the app-language dictionary (lib/appStrings.mjs); the placeholder is now {n}
  srcHas("lib/appStrings.mjs", "Only the first {n} checked passages are used", "SOURCE I3 first-5 note English kept"); // v63
  srcHas("app/signin/page.js", "/pack/generated-genesis-1", "SOURCE W11 sign-in tip points at demo share page");
  srcHas("app/about/page.js", '"about.step4Title"', "SOURCE W14 About lock wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Approve and Lock locks it", "SOURCE W14 About lock wording English kept"); // v63
  srcHas("app/about/page.js", '"about.step3Body"', "SOURCE W15 About hymn wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "a hymn when one matches", "SOURCE W15 About hymn wording English kept"); // v63
  srcHas("app/credits/page.js", '"credits.intro"', "SOURCE W16 Credits wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "the app's OPEN-SOURCE.md", "SOURCE W16 Credits wording English kept"); // v63
  // Nov 4, 2026: W1's old assertion (review starts with the
  // demo draft) is superseded. A review page with no draft
  // now shows an empty state, never the Genesis demo.
  srcHas("components/ReviewPage.js", '"review.nothingToReview"', "SOURCE NOV4 review empty state, no demo draft"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Nothing to review yet", "SOURCE NOV4 review empty state English kept"); // v63
  srcNotHas("components/ReviewPage.js", "prefilledDemo", "SOURCE NOV4 demo prefill removed from review");
  srcHas("components/ReviewPage.js", "setInitialPack", "SOURCE W2 reset restores loaded draft");
  srcHas("components/ReviewPage.js", "lockError", "SOURCE W3 lock error surfaces");
  srcHas("components/ReviewPage.js", '"review.checksHeading"', "SOURCE NOV4 plain gates heading"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Checks before you lock", "SOURCE NOV4 plain gates heading English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.notReadyLock"', "SOURCE NOV4 blocked lock message"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Not ready to lock yet", "SOURCE NOV4 blocked lock message English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.needsLook"', "SOURCE NOV4 flagged sections"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Needs a look", "SOURCE NOV4 flagged sections English kept"); // v63
  srcHas("components/ReviewPage.js", "/api/review-log", "SOURCE NOV4 review logging post");
  // Nov 11, 2026, v53: the label is now the language table
  // (T.questionLabel), but the field is still a multiline
  // textarea, which is what this check pins.
  srcHas("components/ReviewPage.js", 'tf(appLanguage, "review.questionLabel", { n: i + 1 })} multiline', "SOURCE NOV4 question textareas"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.questionLabel": "Question {n}"', "SOURCE NOV4 question textareas English kept"); // v63
  srcHas("components/InputPage.js", 't("input.step1")', "SOURCE NOV4 input walkthrough steps"); // v62: step heading moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"Step 1 of 3: What is this pack about?"', "SOURCE NOV4 input walkthrough steps English kept"); // v62
  srcHas("components/InputPage.js", '"input.usePicked"', "SOURCE NOV4 picked passages button"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Use picked passages", "SOURCE NOV4 picked passages button English kept"); // v63
  srcHas("components/InputPage.js", 't("input.startBuilding")', "SOURCE NOV4 pastor build button"); // v62: button label moved to the app-language dictionary
  srcHas("lib/appStrings.mjs", '"Start building this pack"', "SOURCE NOV4 pastor build button English kept"); // v62
  srcHas("components/InputPage.js", 't("input.buildingNow")', "SOURCE NOV4 prominent build banner"); // v62: banner moved to the app-language dictionary
  srcHas("lib/appStrings.mjs", '"Your pack is being built!"', "SOURCE NOV4 prominent build banner English kept"); // v62
  srcHas("components/InputPage.js", '"input.timeLeftOne"', "SOURCE NOV4 time estimate"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "left (estimate)", "SOURCE NOV4 time estimate English kept"); // v63
  srcHas("components/InputPage.js", '"input.topicResultsNote"', "SOURCE NOV4 top-slice note"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "25 most-cited passages", "SOURCE NOV4 top-slice note English kept"); // v63
  srcNotHas("components/InputPage.js", "Job ${", "SOURCE NOV4 no job id rendered");
  srcHas("app/signin/page.js", 'window.location.href = "/input"', "SOURCE NOV4 sign-in lands on Start a pack");
  srcHas("app/signin/page.js", "Forgot your password?", "SOURCE NOV4 forgot password link");
  srcHas("app/signin/page.js", "Password rule for this demo version", "SOURCE NOV4 visible password rule");
  srcOrder("components/AppHeader.js", 't(appLanguage, "nav.start")', 't(appLanguage, "nav.review")', "SOURCE NOV4 nav order Start before Review"); // v55: CTA class + "+" prefix; v62: nav labels moved to the app-language dictionary (lib/appStrings.mjs), order checked on the t() calls
  srcHas("app/about/page.js", '"about.howAi"', "SOURCE NOV4 About AI section"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "How AI works in Flockpath", "SOURCE NOV4 About AI section English kept"); // v63
  srcHas("app/about/page.js", '"about.aiNever1"', "SOURCE NOV4 About refs-only line"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "references only", "SOURCE NOV4 About refs-only line English kept"); // v63
  srcHas("lib/auth.mjs", "LOCKOUT_AFTER", "SOURCE NOV4 sign-in lockout");
  srcHas("app/api/password/route.js", "changePassword", "SOURCE NOV4 change password route");
  srcHas("app/forgot/page.js", "reset-password.mjs", "SOURCE NOV4 forgot page local reset path");
  srcHas("app/packs/page.js", '"packs.churchLogo"', "SOURCE NOV4 My packs top logo"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Your church logo:", "SOURCE NOV4 My packs top logo English kept"); // v63
  srcHas("components/PdfRetryButton.js", "Build print PDF", "SOURCE NOV4 PDF retry button");
  srcHas("app/pack/[id]/page.js", "PdfRetryButton", "SOURCE NOV4 pack page retry wiring");
  srcHas("scripts/build-pdf.mjs", "mkdirSync(new URL(\"../output/\"", "SOURCE NOV4 PDF output mkdir");
  srcHas("scripts/generate_worker.py", "Picked up job", "SOURCE NOV4 worker pickup line");
  srcHas("scripts/generate_worker.py", "flush=True", "SOURCE NOV4 worker flush");
  srcHas("scripts/extract_refs.py", "jno", "SOURCE NOV4 extractor John aliases");
  srcHas("scripts/extract_refs.py", "CONT_RE", "SOURCE NOV4 comma continuations");
  srcHas("scripts/topic_search.py", "most_common(25)", "SOURCE NOV4 topic top 25");
  srcHas("scripts/topic_search.py", "term_matches", "SOURCE NOV4 topic whole-word filter");
  srcHas("app/api/generate/route.js", "up to 30 minutes", "SOURCE NOV5 generate note time range");
  srcNotHas("app/api/generate/route.js", "30 to 90 minutes", "SOURCE NOV5 old time range gone from generate note");
  srcHas("lib/quality.mjs", "At least one day must stay", "SOURCE I1 quality one-day rule");
  srcHas("app/api/packs/pdf/route.js", "unlinkSync(packFile)", "SOURCE I4 PDF temp cleanup");

  // Nov 5, 2026, round-2 batch.
  srcHas("components/JourneyStrip.js", "Approve and lock", "SOURCE NOV5 journey strip stages");
  srcNotHas("components/InputPage.js", "FlowSteps", "SOURCE NOV5 FlowSteps replaced on input");
  srcNotHas("components/ReviewPage.js", "FlowSteps", "SOURCE NOV5 FlowSteps replaced on review");
  srcHas("components/InputPage.js", "JourneyStrip", "SOURCE NOV5 input journey strip");
  srcHas("components/InputPage.js", "flockpath-active-job", "SOURCE NOV5 job restore on return");
  srcHas("components/InputPage.js", '"input.checking"', "SOURCE NOV5 instant check feedback"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"input.checking": "Checking..."', "SOURCE NOV5 instant check feedback English kept"); // v63
  srcHas("components/InputPage.js", '"input.lastChecked"', "SOURCE NOV5 last checked time"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Last checked", "SOURCE NOV5 last checked time English kept"); // v63
  srcHas("components/InputPage.js", '"input.whatHappens"', "SOURCE NOV5 stay-or-leave copy"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "You can leave this page and come back", "SOURCE NOV5 stay-or-leave copy English kept"); // v63
  srcHas("components/InputPage.js", 't("input.step1")', "SOURCE NOV5 step 1 question title"); // v62: step heading moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"Step 1 of 3: What is this pack about?"', "SOURCE NOV5 step 1 question title English kept"); // v62
  srcHas("components/InputPage.js", 't("input.step2")', "SOURCE NOV5 step 2 question title"); // v62: step heading moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"Step 2 of 3: Which verses should it use?"', "SOURCE NOV5 step 2 question title English kept"); // v62
  srcHas("components/InputPage.js", 't("input.step3")', "SOURCE NOV5 step 3 question title"); // v62: step heading moved to the app-language dictionary
  srcHas("lib/appStrings.mjs", '"Step 3 of 3: What should it be called?"', "SOURCE NOV5 step 3 question title English kept"); // v62
  srcNotHas("components/InputPage.js", "status banner above", "SOURCE NOV5 no banner-above copy");
  srcNotHas("components/InputPage.js", "top of the page", "SOURCE NOV5 no top-of-page copy");
  srcNotHas("components/InputPage.js", "/?draft=", "SOURCE NOV5 input links use /review");
  srcOrder("components/InputPage.js", 't("input.step3")', 't("input.buildingNow")', "SOURCE NOV5 build panel below the steps"); // v62: step heading + banner moved to the app-language dictionary
  srcHas("components/ReviewPage.js", '"review.draftBanner"', "SOURCE NOV5 review draft line"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "This is a draft for your review", "SOURCE NOV5 review draft line English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.resetButton"', "SOURCE NOV5 reset wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Start over from the generated draft", "SOURCE NOV5 reset wording English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.dayAdult"', "SOURCE NOV5 adult field label"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.dayAdult": "For adults"', "SOURCE NOV5 adult field label English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.packIncludesOne"', "SOURCE NOV5 pack contents line"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "The days you leave checked", "SOURCE NOV5 pack contents line English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.readyLock"', "SOURCE NOV5 bottom approve block"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.readyLock": "Ready to lock?"', "SOURCE NOV5 bottom approve block English kept"); // v63
  srcHas("components/ReviewPage.js", "quotes the verse. A retelling should say it in fresh words", "SOURCE NOV5 retelling warning wording");
  srcHas("components/ReviewPage.js", '"review.lengthNotesOne"', "SOURCE NOV5 length notes wording"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "background notes", "SOURCE NOV5 length notes wording English kept"); // v63
  srcNotHas("components/ReviewPage.js", "Reset to generated draft", "SOURCE NOV5 old reset wording gone");
  srcNotHas("components/ReviewPage.js", "Reviewing a generated draft", "SOURCE NOV5 old draft line gone");
  srcHas("app/pack/[id]/page.js", "Approval code", "SOURCE NOV5 share Approval code");
  srcHas("app/pack/[id]/page.js", "Leader notes and the reading verse are in the print PDF", "SOURCE NOV5 share leader note");
  srcHas("app/pack/[id]/page.js", "pdf-file?id=", "SOURCE NOV5 share PDF route link");
  srcHas("app/pack/[id]/page.js", "coloringId", "SOURCE NOV5 share stored coloring pick");
  srcHas("app/packs/page.js", '"packs.downloadPdf"', "SOURCE NOV5 My packs PDF link"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"packs.downloadPdf": "Download print PDF"', "SOURCE NOV5 My packs PDF link English kept"); // v63
  srcHas("app/packs/page.js", "/review?draft=", "SOURCE NOV5 My packs draft link");
  srcHas("app/packs/page.js", "kind=logo", "SOURCE NOV5 My packs logo route");
  srcHas("components/ChurchLogoSettings.js", "kind=logo", "SOURCE NOV5 logo setting route");
  srcHas("lib/quality.mjs", "retelling quotes the verse itself", "SOURCE NOV5 retelling warning gate");
  srcHas("scripts/build-pdf.mjs", "sourceLabels", "SOURCE NOV5 PDF sources dedupe");
  srcHas("scripts/build-pdf.mjs", "classicQuote", "SOURCE NOV5 PDF classic quote fix");
  srcHas("scripts/build-pdf.mjs", "replace(/ Coloring$/", "SOURCE NOV5 PDF coloring heading");
  srcHas("scripts/generate_sections.py", "n_gpu_layers=-1", "SOURCE NOV5 GPU layers");
  srcHas("scripts/generate_sections.py", "falling back to CPU-only", "SOURCE NOV5 GPU fallback");
  srcHas("app/page.js", 't(appLanguage, "home.suggestedPacks")', "SOURCE V55 root is the Dashboard"); // v62: dashboard heading moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"Suggested next packs"', "SOURCE V55 dashboard suggested heading English kept"); // v62
  srcNotHas("app/page.js", 'redirect("/input")', "SOURCE V55 root no longer redirects to Start");
  srcHas("app/review/page.js", "ReviewPage", "SOURCE NOV5 review route");
  srcHas("app/api/packs/pdf-file/route.js", "Print PDF not ready", "SOURCE NOV5 file route not-ready page");
  srcHas("app/api/packs/pdf/route.js", "pdf-file?id=", "SOURCE NOV5 lock-step PDF route link");

  // Nov 5, 2026, round-2 consistency: the proof line is
  // "Approval code" everywhere a pastor or family sees
  // it (share page, PDF, review locked view, My packs),
  // never "Lock hash" in user copy. The lockHash field
  // name and API errors stay technical.
  // Nov 11, 2026, v53: the label is now a language ternary
  // ("Código de aprobación" / "Approval code"), so the pin
  // is the English branch, not the old literal with colon.
  srcHas("scripts/build-pdf.mjs", "\"Approval code\"", "SOURCE NOV5 PDF Approval code");
  srcNotHas("scripts/build-pdf.mjs", "Lock hash:", "SOURCE NOV5 PDF Lock hash gone");

  // Nov 18, 2026: the Spanish hymn meter line. The meter VALUE
  // comes from Hymn Desk data and carries English wording
  // ("Not stated on source pages", "with refrain", "with
  // alleluia"), so the PDF label was already "Metro" while the
  // value still printed English. formatMeter() translates the
  // words for Spanish packs; the email builder mirrors it for
  // its meter line only.
  srcHas("lib/translation.mjs", "formatMeter", "SOURCE NOV18 meter translator exists");
  srcHas("lib/translation.mjs", "No indicado en las fuentes", "SOURCE NOV18 meter unstated in Spanish");
  srcHas("lib/translation.mjs", "con estribillo", "SOURCE NOV18 meter refrain in Spanish");
  srcHas("scripts/build-pdf.mjs", "formatMeter(pack.hymn.meter, lang)", "SOURCE NOV18 PDF uses formatMeter");
  srcHas("scripts/build-email.py", "format_meter_es", "SOURCE NOV18 email uses format_meter_es");
  srcHas("scripts/build-email.py", "Metro", "SOURCE NOV18 email meter label in Spanish");
  srcHas("components/ReviewPage.js", '"review.approvalCode"', "SOURCE NOV5 review Approval code"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.approvalCode": "Approval code:"', "SOURCE NOV5 review Approval code English kept"); // v63
  srcNotHas("components/ReviewPage.js", "Lock hash:", "SOURCE NOV5 review Lock hash gone");
  srcHas("app/packs/page.js", '"packs.approvalCode"', "SOURCE NOV5 My packs Approval code"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"packs.approvalCode": "Approval code:"', "SOURCE NOV5 My packs Approval code English kept"); // v63
  srcNotHas("app/packs/page.js", "Lock hash:", "SOURCE NOV5 My packs Lock hash gone");

  // Nov 5, 2026, round-2 retelling warning (review-only,
  // never a block): a kid retelling that opens with the
  // day verse must warn, and a retelling in fresh words
  // must stay quiet.
  const { checkQuality } = await import(path.join(ROOT, "lib", "quality.mjs"));
  const warnDraft = {
    memoryVerse: { reference: "1JN 4:19" },
    adultDevotionals: [{ day: "Monday", title: "Love First", scripture: { reference: "1JN 4:19", text: "We love because He first loved us." }, body: "God loved us before we knew Him, and that love changes how we love others today.", prayer: "Father, teach us to love as You loved us first." }],
    kidDevotionals: [{ day: "Monday", title: "Love First", retelling: "We love because He first loved us. God loved us first, so we can love other people too.", activity: "Draw a heart for someone you love." }],
    leaderQuestions: [],
  };
  const warnResult = checkQuality(warnDraft);
  check("NOV5 retelling opening with the verse warns", (warnResult.warnings ?? []).some((w) => w.includes("retelling quotes the verse itself")), `got ${JSON.stringify(warnResult.warnings)}`);
  const cleanDraft = JSON.parse(JSON.stringify(warnDraft));
  cleanDraft.kidDevotionals[0].retelling = "God loved us first, so we can love other people too.";
  const cleanResult = checkQuality(cleanDraft);
  check("NOV5 retelling in fresh words does not warn", !(cleanResult.warnings ?? []).some((w) => w.includes("retelling quotes the verse itself")), `got ${JSON.stringify(cleanResult.warnings)}`);

  // Nov 5, 2026, round-3: the James speed-run pack's
  // Thursday retelling quotes its verse in the SECOND
  // sentence, which the first-sentence-only check missed.
  // The widened opening-two-sentences check must catch
  // it, and must stay quiet on fresh words.
  const thuDraft = JSON.parse(JSON.stringify(warnDraft));
  thuDraft.adultDevotionals[0].scripture = { reference: "JAS 1:19", text: "My beloved brothers, understand this: Everyone should be quick to listen, slow to speak, and slow to anger," };
  thuDraft.kidDevotionals[0].retelling = "My beloved brothers, listen closely. Everyone should be quick to listen, slow to speak, and slow to anger. God wants us to be kind and wise.";
  const thuResult = checkQuality(thuDraft);
  check("NOV5 round-3 retelling quoting verse in second sentence warns", (thuResult.warnings ?? []).some((w) => w.includes("retelling quotes the verse itself")), `got ${JSON.stringify(thuResult.warnings)}`);
  const monDraft = JSON.parse(JSON.stringify(warnDraft));
  monDraft.adultDevotionals[0].scripture = { reference: "JAS 1:4", text: "Allow perseverance to finish its work, so that you may be mature and complete, not lacking anything." };
  monDraft.kidDevotionals[0].retelling = "James tells us that we must let patience do its job. When we wait for God, He helps us grow strong and finish the work He started.";
  const monResult = checkQuality(monDraft);
  check("NOV5 round-3 retelling in fresh words does not warn", !(monResult.warnings ?? []).some((w) => w.includes("retelling quotes the verse itself")), `got ${JSON.stringify(monResult.warnings)}`);

  // Nov 5, 2026, v25: the 7b warning now covers the WHOLE
  // retelling, not just the opening two sentences. The Nov
  // 4 James pack's Friday retelling quoted a verse clause
  // in its THIRD sentence, which the old scope missed.
  const thirdDraft = JSON.parse(JSON.stringify(warnDraft));
  thirdDraft.adultDevotionals[0].scripture = { reference: "JHN 3:16", text: "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life." };
  thirdDraft.kidDevotionals[0].retelling = "God loves us very much. He sent His Son to save us. For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";
  const thirdResult = checkQuality(thirdDraft);
  check("NOV5 v25 retelling quoting verse in third sentence warns", (thirdResult.warnings ?? []).some((w) => w.includes("retelling quotes the verse itself")), `got ${JSON.stringify(thirdResult.warnings)}`);

  // Round-3: a kid title already converted to the full
  // book name ("James 1:4") must still trip the
  // title-is-the-verse-reference warning, and the Read
  // directive strip must accept the full-name form.
  const titleDraft = JSON.parse(JSON.stringify(warnDraft));
  titleDraft.adultDevotionals[0].scripture = { reference: "JAS 1:4", text: "Allow perseverance to finish its work, so that you may be mature and complete, not lacking anything." };
  titleDraft.kidDevotionals[0].title = "James 1:4";
  const titleResult = checkQuality(titleDraft);
  check("NOV5 round-3 converted kid title still flags as verse reference", (titleResult.warnings ?? []).some((w) => w.includes("title is the verse reference")), `got ${JSON.stringify(titleResult.warnings)}`);
  const noteDraft = JSON.parse(JSON.stringify(warnDraft));
  noteDraft.leaderQuestions = [{ question: "What does James 1:4 say?", leaderNote: `${"word ".repeat(69).trim()} (Read James 1:4.)` }];
  const noteResult = checkQuality(noteDraft);
  check("NOV5 round-3 full-name Read directive does not count toward note length", !(noteResult.warnings ?? []).some((w) => w.includes("Leader Q1: note")), `got ${JSON.stringify(noteResult.warnings)}`);

  // Nov 5, 2026, round-5, option B (Jeremiah's call): a kid
  // section that names Jesus is a WARNING everywhere, never
  // a block, even when its verse does not name him. The
  // parable case is the one that lost three days in the Nov
  // 5 Powers of God's Word test: Jesus is speaking, so the
  // verse cannot name its own speaker.
  const jesusDraft = JSON.parse(JSON.stringify(warnDraft));
  jesusDraft.adultDevotionals[0].scripture = { reference: "LUK 8:11", text: "Now this is the meaning of the parable: The seed is the word of God." };
  jesusDraft.kidDevotionals[0].retelling = "Jesus told a story about a farmer who scattered seed on the ground. The seed is God's word, and it grows in hearts that listen.";
  const jesusResult = checkQuality(jesusDraft);
  // The fixture carries unrelated issues (a duplicated title,
  // a one-sentence body), so assert on the Jesus check itself:
  // no Jesus issue, and the Jesus warning present.
  check("NOV5 round-5 kid naming Jesus in a parable verse warns, never blocks", !(jesusResult.issues ?? []).some((i) => /Jesus|Christ/.test(i)) && (jesusResult.warnings ?? []).some((w) => w.includes("names Jesus or Christ")), `got issues ${JSON.stringify(jesusResult.issues)} warnings ${JSON.stringify(jesusResult.warnings)}`);
  const sonDraft = JSON.parse(JSON.stringify(warnDraft));
  sonDraft.adultDevotionals[0].scripture = { reference: "JHN 3:16", text: "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life." };
  sonDraft.kidDevotionals[0].retelling = "Jesus loves us so much. God gave His Son so we can live with Him forever.";
  const sonResult = checkQuality(sonDraft);
  check("NOV5 round-5 kid naming Jesus with a Son verse warns, never blocks", !(sonResult.issues ?? []).some((i) => /Jesus|Christ/.test(i)) && (sonResult.warnings ?? []).some((w) => w.includes("names Jesus, but its verse says Son")), `got issues ${JSON.stringify(sonResult.issues)} warnings ${JSON.stringify(sonResult.warnings)}`);

  // Nov 5, 2026, round-5: leader questions belong to days
  // (one per day, in day order), so an unchecked day's
  // question leaves with it. A question past the last day
  // is kept, never dropped on a guess.
  const { leaderQuestionsForDays } = await import(path.join(ROOT, "lib", "pack.mjs"));
  const fiveQs = [1, 2, 3, 4, 5].map((n) => ({ question: `Q${n}`, leaderNote: `note ${n}` }));
  const twoDayQs = leaderQuestionsForDays(fiveQs, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], new Set(["Monday", "Tuesday"]));
  check("NOV5 round-5 leader questions filter to checked days", twoDayQs.length === 2 && twoDayQs[0].question === "Q1" && twoDayQs[1].question === "Q2", `got ${JSON.stringify(twoDayQs.map((q) => q.question))}`);
  const extraQs = leaderQuestionsForDays([...fiveQs, { question: "Q6", leaderNote: "extra" }], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], new Set(["Monday"]));
  check("NOV5 round-5 leader question past the last day is kept, not dropped", extraQs.length === 2 && extraQs[1].question === "Q6", `got ${JSON.stringify(extraQs.map((q) => q.question))}`);

  // Nov 5, 2026, round-5 hymn fallback: when nothing scores,
  // the matcher returns the closest related hymns flagged
  // related, never auto-picked; a true-zero case returns none.
  // A pack may carry 5 candidates (the fallback offers 5),
  // and a related flag on a candidate never reaches the
  // locked pack: Zod strips it, and candidates are dropped.
  const hymnDesk = path.join(ROOT, "..", "hymn-desk");
  // Nov 17, 2026, v57: the old fallback case (JER 23:29 + hammer)
  // no longer falls back — the expanded index (1,489 hymns) now
  // holds a hymn anchored to JER 23:29, so match() scores it
  // directly. JDG 1:1 + hammer still triggers the fallback: no
  // hymn anchors to Judges 1:1 or carries a hammer tag, so
  // related() returns book-matched hymns flagged related.
  const fallbackOut = await runCmd("python3", [path.join(hymnDesk, "scripts", "match_hymn.py"), "JDG 1:1", "hammer", "--json"], { cwd: ROOT });
  const fallback = JSON.parse(fallbackOut.stdout);
  check("NOV5 round-5 hymn fallback returns related hymns, no auto-pick", fallback.length > 0 && fallback.every((c) => c.related === true), `got ${fallbackOut.stdout.slice(0, 200)}`);
  const zeroOut = await runCmd("python3", [path.join(hymnDesk, "scripts", "match_hymn.py"), "OBA 1:1", "zzzz", "--json"], { cwd: ROOT });
  check("NOV5 round-5 hymn fallback with nothing related returns none", JSON.parse(zeroOut.stdout).length === 0, `got ${zeroOut.stdout.slice(0, 200)}`);
  const hymnIndex = JSON.parse(readFileSync(path.join(hymnDesk, "data", "hymns.json"), "utf-8")).hymns;
  // Nov 17, 2026, v57: the index grew from 44 hymns (Nov 5) to
  // 1,489 via the Watts verification batches, and it is still
  // growing as that program lands batches. A floor, not an exact
  // count, so growth does not red the suite: it catches a
  // truncated or emptied index, which is what this check is for.
  check("NOV5 round-5 hymn index holds at least 1489 hymns (Nov 17 count)", hymnIndex.length >= 1489, `got ${hymnIndex.length}`);
  const fivePack = JSON.parse(JSON.stringify(realPack));
  delete fivePack.lockHash;
  fivePack.hymnCandidates = hymnIndex.slice(0, 5).map((h, i) => (i === 0 ? { ...h, related: true } : h));
  fivePack.hymn = { ...hymnIndex[0], related: true };
  const fiveLocked = lockPack(fivePack, bsbPsa, "bsb");
  check("NOV5 round-5 pack with 5 hymn candidates locks", fiveLocked.ok, (fiveLocked.errors || []).join(" "));
  check("NOV5 round-5 locked pack drops candidates and the related flag", fiveLocked.ok && !("hymnCandidates" in fiveLocked.pack) && fiveLocked.pack.hymn && !("related" in fiveLocked.pack.hymn), `got candidates ${JSON.stringify(fiveLocked.pack?.hymnCandidates)} related ${JSON.stringify(fiveLocked.pack?.hymn?.related)}`);

  // Nov 5, 2026, round-5 quote snap: a fragment must snap
  // to its full sentence, or drop when the sentence is too
  // long. Pure unit test, no model run.
  const snapOut = await runCmd(".venv/bin/python", ["output/sermon-quote-snap-test.py"], { cwd: ROOT });
  check("NOV5 round-5 sermon quote snaps to a full sentence", /7 passed, 0 failed/.test(snapOut.stdout), snapOut.stdout.slice(0, 200));

  // Nov 5, 2026, v25: pure unit tests for the generation
  // helpers (no model run).
  const v25Out = await runCmd(".venv/bin/python", ["output/v25-helpers-test.py"], { cwd: ROOT });
  check("NOV5 v25 generation helpers pass", /14 passed, 0 failed/.test(v25Out.stdout), v25Out.stdout.slice(0, 200));

  // Nov 5, 2026, fresh-eyes fix: Roman-numeral book
  // prefixes in the ref extractor (no model run).
  const romanOut = await runCmd(".venv/bin/python", ["output/roman-numerals-test.py"], { cwd: ROOT });
  check("NOV5 Roman-numeral extractor passes", /10 passed, 0 failed/.test(romanOut.stdout), romanOut.stdout.slice(0, 200));

  // Nov 5, 2026, v26: draw-God swap, sermon-quote retry
  // and code fallback, kid-title verse words (no model run).
  const v26Out = await runCmd(".venv/bin/python", ["output/v26-proof.py"], { cwd: ROOT });
  check("NOV5 v26 generation helpers pass", /11 passed, 0 failed/.test(v26Out.stdout), v26Out.stdout.slice(0, 200));
  const v26NodeOut = await runCmd("node", ["output/v26-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v26 Son-of-Man gate and quoted quote pass", /7 passed, 0 failed/.test(v26NodeOut.stdout), v26NodeOut.stdout.slice(0, 200));

  // Nov 5, 2026, v27: Enemies pack review. The cover
  // overflowed to a blank page 2, leader textPoints came
  // back as fragments, Thursday's prayer was an
  // instruction, and the PDF download name was a job
  // number. No model run for the cover, fragment, prayer
  // or naming checks; the leader prompt is source only.
  const v27Out = await runCmd(".venv/bin/python", ["output/v27-proof.py"], { cwd: ROOT });
  check("NOV5 v27 note-fragment drop passes", /10 passed, 0 failed/.test(v27Out.stdout), v27Out.stdout.slice(0, 200));
  const v27NodeOut = await runCmd("node", ["output/v27-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v27 prayer warning and PDF name pass", /8 passed, 0 failed/.test(v27NodeOut.stdout), v27NodeOut.stdout.slice(0, 200));
  const v27CoverOut = await runCmd("node", ["output/v27-cover-proof.mjs"], { cwd: ROOT });
  check("NOV5 v27 worst-case cover stays 9 pages", /1 passed, 0 failed/.test(v27CoverOut.stdout), v27CoverOut.stdout.slice(0, 200));

  // Nov 5, 2026, v28: verse ranges are one passage unit
  // (Matthew 28:18-20 stays together as one day, the lock
  // verifies it against the joined store text), the share
  // link carries the same friendly name as the PDF, and a
  // long verse is shortened in the PDF print only, when it
  // overflows (over 300 characters), as an exact excerpt.
  const v28Out = await runCmd(".venv/bin/python", ["output/v28-proof.py"], { cwd: ROOT });
  check("NOV5 v28 range extractor and resolver pass", /11 passed, 0 failed/.test(v28Out.stdout), v28Out.stdout.slice(0, 200));
  const v28NodeOut = await runCmd("node", ["output/v28-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v28 range verify and share slug pass", /28 passed, 0 failed/.test(v28NodeOut.stdout), v28NodeOut.stdout.slice(0, 200));
  const v28ShortenOut = await runCmd("node", ["output/v28-shorten-proof.mjs"], { cwd: ROOT });
  check("NOV5 v28 PDF verse shortening passes", /5 passed, 0 failed/.test(v28ShortenOut.stdout), v28ShortenOut.stdout.slice(0, 200));

  // Nov 5, 2026, v29: the application anchor. The Golden
  // Thread 3 Thursday application (woodworking for
  // Revelation 22:1-5) and Friday application (weekend
  // planning for Acts 1:9-11) did not apply their verses.
  // The prompt now anchors bodyToday in the verse's words
  // and the carpentry length example is gone; a
  // generation-time check retries an unanchored
  // application; the review page warns on one that still
  // slips through.
  const v29Out = await runCmd(".venv/bin/python", ["output/v29-proof.py"], { cwd: ROOT });
  check("NOV5 v29 anchor counts and prompt fix pass", /9 passed, 0 failed/.test(v29Out.stdout), v29Out.stdout.slice(0, 200));
  const v29NodeOut = await runCmd("node", ["output/v29-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v29 review warning flags Thursday and Friday", /6 passed, 0 failed/.test(v29NodeOut.stdout), v29NodeOut.stdout.slice(0, 200));

  // Nov 5, 2026, v30: the prayer structure and the
  // example copy. The Golden Thread 4 prayers were not
  // prayers (they talk about God, they never address Him,
  // and none closes with Amen), and the v29 dinner-table
  // length example was itself copied into Tuesday's
  // application. The prayer prompt now names the
  // four-part shape, the generation and review checks
  // require a real address and a closing Amen, bodyToday
  // has no example, and a sentence-level check catches a
  // partial example copy.
  const v30Out = await runCmd(".venv/bin/python", ["output/v30-proof.py"], { cwd: ROOT });
  check("NOV5 v30 prayer and example-copy checks pass", /21 passed, 0 failed/.test(v30Out.stdout), v30Out.stdout.slice(0, 200));
  const v30NodeOut = await runCmd("node", ["output/v30-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v30 review warns on all five Golden Thread 4 prayers", /8 passed, 0 failed/.test(v30NodeOut.stdout), v30NodeOut.stdout.slice(0, 200));

  // Nov 5, 2026, v31: the P.A.T.H. prayer. Jeremiah's
  // framework mirrors the Lord's Prayer (Praise,
  // Apologize, Thanks, Help) and fits the app's name
  // (Flockpath). The Cross of Jesus prayers (built on
  // v30) address God, thank Him, and ask for help, but
  // none confesses anything, so they read like
  // prayer-flavored summaries, and Wednesday is missing
  // its Amen. The prompt now uses P.A.T.H., one clause
  // per letter, and the generation and review checks flag
  // each missing part by name.
  const v31Out = await runCmd(".venv/bin/python", ["output/v31-proof.py"], { cwd: ROOT });
  check("NOV5 v31 P.A.T.H. part detection passes", /34 passed, 0 failed/.test(v31Out.stdout), v31Out.stdout.slice(0, 200));
  const v31NodeOut = await runCmd("node", ["output/v31-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v31 review warns on missing Apologize and Wednesday Amen", /6 passed, 0 failed/.test(v31NodeOut.stdout), v31NodeOut.stdout.slice(0, 200));

  // Nov 5, 2026, v32: two fixes from the Cross of Jesus 2
  // review. (1) The P.A.T.H. label echo: the v31 prompt
  // named the parts (P) Praise, (A) Apologize, (T) Thanks,
  // (H) Help, and the model echoed those words as sentence
  // starters ("Apologize for our failures", "Thanks for the
  // Cross"), so none of the five prayers sounded like a
  // natural prayer. The prompt now gives the natural words
  // ("Forgive us", "Thank You", "Help us") and forbids the
  // labels; bare "Thanks" no longer counts as Thanks, and
  // the word "Apologize" itself is flagged. (2) The Rewrite
  // button: when the review page flags an adult body for
  // quoting its verse verbatim, the pastor clicks Rewrite
  // and the model rewrites just the offending paragraph(s)
  // in its own words, instead of deleting a whole paragraph
  // by hand. The verse is never in the prompt, and the
  // result is verified against the verse in code.
  const v32Out = await runCmd(".venv/bin/python", ["output/v32-proof.py"], { cwd: ROOT });
  check("NOV5 v32 P.A.T.H. label echo and Rewrite pass", /34 passed, 0 failed/.test(v32Out.stdout), v32Out.stdout.slice(0, 200));
  const v32NodeOut = await runCmd("node", ["output/v32-proof-node.mjs"], { cwd: ROOT });
  check("NOV5 v32 review warns on the Apologize label and missing Thanks", /6 passed, 0 failed/.test(v32NodeOut.stdout), v32NodeOut.stdout.slice(0, 200));

  // Nov 5, 2026, round-3 cover note (v24): the sermon
  // quote must verify against the pasted sermon, the
  // pastor-note verse must verify against the store, and
  // a pastor-typed reference must parse back to a code
  // ref. The snapshot and the note ride through expandDraft
  // into a lockable pack.
  const { verifyPack } = await import(path.join(ROOT, "lib", "pack.mjs"));
  const { parseRef } = await import(path.join(ROOT, "lib", "refs.mjs"));
  const { expandDraft } = await import(path.join(ROOT, "lib", "generate.mjs"));
  check("NOV5 round-3 parseRef full name", parseRef("James 1:4") === "JAS 1:4", `got ${parseRef("James 1:4")}`);
  check("NOV5 round-3 parseRef numbered book", parseRef("1 John 4:19") === "1JN 4:19", `got ${parseRef("1 John 4:19")}`);
  check("NOV5 round-3 parseRef code passes through", parseRef("JAS 1:4") === "JAS 1:4", `got ${parseRef("JAS 1:4")}`);
  check("NOV5 round-3 parseRef psalm", parseRef("Psalm 23:6") === "PSA 23:6", `got ${parseRef("Psalm 23:6")}`);
  check("NOV5 round-3 parseRef unknown book is null", parseRef("Nonsense 1:1") === null, `got ${parseRef("Nonsense 1:1")}`);
  check("NOV5 round-3 parseRef bare book is null", parseRef("James") === null, `got ${parseRef("James")}`);
  const coverSermon = "The Lord is my shepherd, I shall not want. He makes me lie down in green pastures. He leads me beside quiet waters. He restores my soul. Surely goodness and mercy shall follow me all the days of my life.";
  const coverSummary = "The Lord shepherds His people with steady care, giving rest, guidance, and goodness for every day of life.";
  const coverStore = { ...bsbPsa, ...JSON.parse(readFileSync(path.join(ROOT, "data", "bsb-JAS.json"), "utf-8")) };
  const coverBase = JSON.parse(JSON.stringify(realPack));
  delete coverBase.lockHash;
  delete coverBase.lockedAt;
  coverBase.sermonText = coverSermon;
  coverBase.sermonSnapshot = { summary: coverSummary, quote: "He restores my soul." };
  const coverOk = verifyPack(coverBase, coverStore, "bsb");
  check("NOV5 round-3 matching sermon quote verifies", coverOk.ok, (coverOk.errors || []).join(" "));
  const coverBadQuote = JSON.parse(JSON.stringify(coverBase));
  coverBadQuote.sermonSnapshot = { summary: coverSummary, quote: "He restores my spirit." };
  const coverBad = verifyPack(coverBadQuote, coverStore, "bsb");
  check("NOV5 round-3 edited quote that is not in the sermon blocks", !coverBad.ok && (coverBad.errors || []).some((e) => e.includes("Sermon quote does not match")), `got ${JSON.stringify(coverBad.errors)}`);
  const coverNoText = JSON.parse(JSON.stringify(coverBase));
  delete coverNoText.sermonText;
  const coverNoTextResult = verifyPack(coverNoText, coverStore, "bsb");
  check("NOV5 round-3 quote with no sermon text blocks", !coverNoTextResult.ok && (coverNoTextResult.errors || []).some((e) => e.includes("cannot be verified")), `got ${JSON.stringify(coverNoTextResult.errors)}`);
  const coverNote = JSON.parse(JSON.stringify(coverBase));
  coverNote.pastorNote = { verse: { reference: "JAS 1:4", translation: "bsb", text: "Allow perseverance to finish its work, so that you may be mature and complete, not lacking anything." }, note: "Hold on. God is finishing His work in you." };
  const coverNoteOk = verifyPack(coverNote, coverStore, "bsb");
  check("NOV5 round-3 pastor-note verse with exact text verifies", coverNoteOk.ok, (coverNoteOk.errors || []).join(" "));
  const coverNoteBad = JSON.parse(JSON.stringify(coverNote));
  coverNoteBad.pastorNote.verse.text = "Allow patience to finish its work.";
  const coverNoteBadResult = verifyPack(coverNoteBad, coverStore, "bsb");
  check("NOV5 round-3 pastor-note verse with wrong text blocks", !coverNoteBadResult.ok && (coverNoteBadResult.errors || []).some((e) => e.includes("Verse mismatch")), `got ${JSON.stringify(coverNoteBadResult.errors)}`);
  const coverDraft = JSON.parse(JSON.stringify(coverBase));
  coverDraft.memoryVerse = { reference: coverDraft.memoryVerse.reference };
  coverDraft.adultDevotionals = coverDraft.adultDevotionals.map((d) => ({ ...d, scripture: { reference: d.scripture.reference } }));
  delete coverDraft.lockHash;
  const coverExpanded = expandDraft(coverDraft, coverStore, "bsb");
  check("NOV5 round-3 expandDraft carries the sermon snapshot and text", coverExpanded.sermonSnapshot?.summary === coverSummary && coverExpanded.sermonText === coverSermon, `got ${JSON.stringify(coverExpanded.sermonSnapshot)}`);
  const coverLocked = lockPack(coverExpanded, coverStore, "bsb");
  check("NOV5 round-3 cover-note pack locks", coverLocked.ok, (coverLocked.errors || []).join(" "));

  // Nov 5, 2026, round-3 cover note PDF: the snapshot
  // prints on the cover under "From the sermon", and a
  // pastor note prints instead under "Pastor's note".
  // Both builds must stay at 10 pages, so the block fits
  // the cover's flexible space. v51: was 9 pages; the
  // Shared Dinner Conversation block and the Scripture
  // in this pack verse list added about 11 lines to the
  // leader page, which was exactly full, so the leader
  // section now spans 2 pages and a full pack is 10.
  const coverPackPath = path.join(ROOT, "output", "cover-test-pack.json");
  const coverPdfPath = path.join(ROOT, "output", "cover-test-pack.pdf");
  const coverTxtPath = path.join(ROOT, "output", "cover-test-pack.txt");
  try {
    writeFileSync(coverPackPath, JSON.stringify(coverLocked.pack, null, 1));
    await runCmd("node", ["scripts/build-pdf.mjs", coverPackPath, coverPdfPath], { cwd: ROOT });
    await runCmd("pdftotext", ["-layout", coverPdfPath, coverTxtPath], { cwd: ROOT });
    const coverText = readFileSync(coverTxtPath, "utf-8");
    check("NOV5 round-3 PDF cover shows the sermon snapshot", coverText.includes("From the sermon") && coverText.includes("He restores my soul."), "snapshot block missing from cover text");
    const coverInfo = await runCmd("pdfinfo", [coverPdfPath], { cwd: ROOT });
    check("NOV5 round-3 PDF with snapshot stays 10 pages", /Pages:\s+10/.test(coverInfo.stdout), coverInfo.stdout.split("\n").find((l) => l.startsWith("Pages:")) || "no page count");
    const notePack = JSON.parse(JSON.stringify(coverLocked.pack));
    notePack.pastorNote = { verse: { reference: "JAS 1:4", translation: "bsb", text: "Allow perseverance to finish its work, so that you may be mature and complete, not lacking anything." }, note: "Hold on. God is finishing His work in you." };
    writeFileSync(coverPackPath, JSON.stringify(notePack, null, 1));
    await runCmd("node", ["scripts/build-pdf.mjs", coverPackPath, coverPdfPath], { cwd: ROOT });
    await runCmd("pdftotext", ["-layout", coverPdfPath, coverTxtPath], { cwd: ROOT });
    // Typst renders the apostrophe in "Pastor's note" as a
    // curly quote (U+2019), so normalize it before matching.
    const noteText = readFileSync(coverTxtPath, "utf-8").replace(/[\u2018\u2019]/g, "'");
    check("NOV5 round-3 PDF cover shows the pastor note instead of the snapshot", noteText.includes("Pastor's note") && noteText.includes("Hold on.") && !noteText.includes("From the sermon"), "pastor-note priority wrong on cover");
    const noteInfo = await runCmd("pdfinfo", [coverPdfPath], { cwd: ROOT });
    check("NOV5 round-3 PDF with pastor note stays 10 pages", /Pages:\s+10/.test(noteInfo.stdout), noteInfo.stdout.split("\n").find((l) => l.startsWith("Pages:")) || "no page count");
  } catch (e) {
    check("NOV5 round-3 PDF cover note builds", false, String(e.message).slice(0, 300));
  } finally {
    for (const f of [coverPackPath, coverPdfPath, coverTxtPath]) { try { unlinkSync(f); } catch {} }
  }

  // Round-3 SOURCE checks: full book names everywhere a
  // pastor looks (review load conversion, PDF kid title,
  // topic and plan lists), and the widened 7b wording.
  srcHas("lib/refs.mjs", "formatRefsInText", "SOURCE NOV5 round-3 refs-in-text helper");
  // Nov 11, 2026, v53: the call now passes the pack language,
  // so the pin is the language-aware form.
  srcHas("scripts/build-pdf.mjs", "formatRefsInText(k.title, lang)", "SOURCE NOV5 round-3 PDF kid title full name");
  srcHas("components/ReviewPage.js", "displayNames(", "SOURCE NOV5 round-3 review display conversion");
  srcHas("components/InputPage.js", "formatRef(r.reference)", "SOURCE NOV5 round-3 topic results full names");
  srcHas("lib/quality.mjs", "opening two sentences", "SOURCE NOV5 round-3 retelling check widened");
  // Nov 11, 2026, v53: the strip also accepts the Spanish
  // "(Lee ...)" directive, so the pin is the wider pattern.
  srcHas("lib/quality.mjs", "(?:Read|Lee) [^)]+", "SOURCE NOV5 round-3 Read strip accepts full names");

  // Nov 5, 2026, round-3 cover note (v24): the sermon text
  // rides from input to generation, the snapshot call is
  // additive after the leader questions, the pack carries
  // the new fields, the review page edits them, and the
  // PDF cover prints one block.
  srcHas("lib/refs.mjs", "parseRef", "SOURCE NOV5 round-3 parseRef helper");
  srcHas("lib/pack.mjs", "sermonSnapshot: SermonSnapshot.optional()", "SOURCE NOV5 round-3 pack sermon snapshot field");
  srcHas("lib/pack.mjs", "pastorNote: PastorNote.optional()", "SOURCE NOV5 round-3 pack pastor note field");
  srcHas("lib/pack.mjs", "Sermon quote does not match", "SOURCE NOV5 round-3 quote verification");
  srcHas("lib/generate.mjs", "sermonSnapshot", "SOURCE NOV5 round-3 expandDraft carries snapshot");
  srcHas("scripts/generate_sections.py", "build_sermon_snapshot", "SOURCE NOV5 round-3 sermon snapshot call");
  srcHas("scripts/generate_sections.py", "SERMON_MIN_WORDS", "SOURCE NOV5 round-3 sermon length guard");
  srcHas("scripts/generate_sections.py", "--sermon-file", "SOURCE NOV5 round-3 sermon file option");
  srcHas("scripts/generate_from_plan.py", "--sermon-file", "SOURCE NOV5 round-3 plan passes sermon file");
  srcHas("app/api/generate/route.js", "sermonText", "SOURCE NOV5 round-3 generate route carries sermon");
  srcHas("components/InputPage.js", "sermonText: text", "SOURCE NOV5 round-3 input posts sermon text");
  srcHas("components/InputPage.js", '"input.pastePara"', "SOURCE NOV5 round-3 input cover copy"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "cover will carry a short summary", "SOURCE NOV5 round-3 input cover copy English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.coverHeading"', "SOURCE NOV5 round-3 review cover section"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.coverHeading": "On the cover"', "SOURCE NOV5 round-3 review cover section English kept"); // v63
  srcHas("components/ReviewPage.js", "/api/verse", "SOURCE NOV5 round-3 review verse resolution");
  srcHas("components/ReviewPage.js", "Sermon quote does not match", "SOURCE NOV5 round-3 review quote plain words");
  srcHas("components/ReviewPage.js", "coverNote", "SOURCE NOV5 round-3 review cover toggle");
  srcHas("scripts/build-pdf.mjs", "Pastor's note", "SOURCE NOV5 round-3 PDF pastor note label");
  srcHas("scripts/build-pdf.mjs", "From the sermon", "SOURCE NOV5 round-3 PDF sermon label");
  srcHas("app/api/verse/route.js", "That verse was not found", "SOURCE NOV5 round-3 verse route");
  srcHas("app/api/packs/route.js", "pastorNote?.verse?.reference", "SOURCE NOV5 round-3 packs route note verse store");

  // Nov 5, 2026, round-5: full names in review controls, the
  // Jesus warning, the hymn fallback, the leader filter, the
  // warning accept, and the full-sentence quote.
  // Nov 11, 2026, v53: the options render through the
  // language-aware fr() helper, so the pins are the fr form.
  srcHas("components/ReviewPage.js", "{fr(r)}</option>", "SOURCE NOV5 round-5 review selects show full names");
  srcHas("components/ReviewPage.js", "fr(pack.memoryVerse.reference)", "SOURCE NOV5 round-5 review memory verse full name");
  srcHas("components/ReviewPage.js", "This is fine", "SOURCE NOV5 round-5 warning accept button");
  srcHas("components/ReviewPage.js", "acceptedWarnings", "SOURCE NOV5 round-5 accepted warnings state");
  srcHas("components/ReviewPage.js", "leaderQuestionsForDays", "SOURCE NOV5 round-5 review leader filter");
  srcHas("components/ReviewPage.js", '"review.hymnNoMatch"', "SOURCE NOV5 round-5 related hymn copy"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "No hymn matched this passage exactly", "SOURCE NOV5 round-5 related hymn copy English kept"); // v63
  srcHas("components/ReviewPage.js", '"review.noHymnFits"', "SOURCE NOV5 round-5 empty hymn copy"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "No hymn in the index fits this passage", "SOURCE NOV5 round-5 empty hymn copy English kept"); // v63
  srcNotHas("components/ReviewPage.js", "No verified hymn matched this passage", "SOURCE NOV5 round-5 old dead-end hymn line gone");
  srcNotHas("lib/quality.mjs", "Edit the kid title or retelling, or uncheck that day", "SOURCE NOV5 round-5 Jesus block wording gone");
  srcHas("lib/quality.mjs", "warning everywhere, never a block", "SOURCE NOV5 round-5 Jesus warning everywhere");
  srcHas("lib/pack.mjs", "hymnCandidates: z.array(Hymn).max(5)", "SOURCE NOV5 round-5 five hymn candidates");
  srcHas("lib/pack.mjs", "leaderQuestionsForDays", "SOURCE NOV5 round-5 leader filter helper");
  // The matcher lives in ../hymn-desk, outside this repo, so
  // no SOURCE check can read it here; the fallback is proven
  // by the two live matcher behavior checks above.
  srcHas("scripts/generate_from_plan.py", "Related hymns offered (no auto-pick)", "SOURCE NOV5 round-5 plan related wiring");
  srcHas("scripts/generate_sections.py", "COMPLETE sentences", "SOURCE NOV5 round-5 quote prompt full sentence");
  srcHas("scripts/generate_sections.py", "_snap_to_sentences", "SOURCE NOV5 round-5 quote snap helper");

  // Nov 5, 2026, v25: negation self-check, kid prompt fix,
  // kid verbatim repair, rhetorical-question rule, and the
  // widened 7b warning.
  srcHas("scripts/generate_sections.py", "RHETORICAL_RULE", "SOURCE NOV5 v25 rhetorical rule");
  srcHas("scripts/generate_sections.py", "check_negation_flip", "SOURCE NOV5 v25 negation self-check");
  srcHas("scripts/generate_sections.py", "repair_negation_flip", "SOURCE NOV5 v25 negation repair");
  srcHas("scripts/generate_sections.py", "quotes_verse_verbatim", "SOURCE NOV5 v25 verbatim helper");
  srcHas("scripts/generate_sections.py", "verse_turns_on_negation", "SOURCE NOV5 v25 negation trigger");
  srcHas("scripts/generate_sections.py", "is_rhetorical_question", "SOURCE NOV5 v25 rhetorical trigger");
  srcHas("scripts/generate_sections.py", "Never copy the verse word for word", "SOURCE NOV5 v25 kid prompt fix");
  srcHas("scripts/generate_sections.py", "negation flip repaired", "SOURCE NOV5 v25 negation repair accepted");
  srcHas("scripts/generate_sections.py", "retelling quotes its verse, paraphrasing", "SOURCE NOV5 v25 kid repair");
  srcNotHas("scripts/generate_sections.py", "in the verse's own words where possible", "SOURCE NOV5 v25 old copy line gone");
  srcHas("lib/quality.mjs", "retelling quotes the verse itself", "SOURCE NOV5 v25 widened 7b warning");
  srcHas("components/ReviewPage.js", "retelling quotes the verse itself", "SOURCE NOV5 v25 review retelling wording");

  // Nov 5, 2026, fresh-eyes fix round: the worker must
  // spawn its own interpreter (not bare python3), the
  // failure reason must reach the pastor, and the extractor
  // must read Roman numerals.
  srcHas("scripts/generate_worker.py", '[sys.executable, "scripts/generate_from_plan.py"', "SOURCE NOV5 worker own interpreter");
  srcHas("scripts/generate_from_plan.py", '[sys.executable, "scripts/build_bsb_store.py"', "SOURCE NOV5 plan BSB store own interpreter");
  srcHas("scripts/generate_from_plan.py", '[sys.executable, str(hymn_script)', "SOURCE NOV5 plan hymn own interpreter");
  srcHas("scripts/extract_refs.py", "normalize_roman_numerals", "SOURCE NOV5 Roman numeral normalizer");
  srcHas("components/InputPage.js", "plainFailureReason", "SOURCE NOV5 failure reason helper");
  srcHas("components/InputPage.js", "No module named", "SOURCE NOV5 failure reason names missing piece");
  srcHas("components/InputPage.js", "failedSetup", "SOURCE NOV5 setup-failure state");
  srcHas("components/InputPage.js", '"input.failedSetupNote"', "SOURCE NOV5 setup-failure panel"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "This stop needs a setup fix", "SOURCE NOV5 setup-failure panel English kept"); // v63
  srcHas("app/api/generate/route.js", "return Response.json({ ok: true, job })", "SOURCE NOV5 generate route returns job error");

  // Nov 5, 2026, demo-pack rebuild: the 3600 s worker cap
  // was shorter than a full VM-CPU pack, and a timeout
  // orphaned the generator. The cap is now 3 hours, the
  // run has its own process group, a timeout kills the
  // whole group, and leader questions checkpoint per
  // question so a resume picks up mid-section.
  srcHas("scripts/generate_worker.py", "WORKER_TIMEOUT_S = 10800", "SOURCE NOV5 worker 3h timeout");
  srcHas("scripts/generate_worker.py", "start_new_session=True", "SOURCE NOV5 worker own process group");
  srcHas("scripts/generate_worker.py", "os.killpg(proc.pid, signal.SIGKILL)", "SOURCE NOV5 worker group kill on timeout");
  srcHas("scripts/generate_worker.py", "pipeline timed out after", "SOURCE NOV5 worker timeout error names cap");
  srcHas("scripts/generate_sections.py", "questions_partial", "SOURCE NOV5 per-question checkpoint");
  srcHas("scripts/generate_sections.py", 'checkpoint.pop("questions_partial", None)', "SOURCE NOV5 partial checkpoint cleared");

  // Nov 5, 2026, v26: Jeremiah's Mac review round. Draw-God
  // activities swap to Jesus, the sermon quote retries and
  // falls back to a short sentence, kid titles get their
  // verse words listed, Son of Man counts as naming Jesus,
  // the cover note hides when a summary exists, and a quote
  // pasted with quotation marks no longer blocks the lock.
  srcHas("scripts/generate_sections.py", "Never ask children to draw God the Father", "SOURCE NOV5 v26 draw-God prompt rule");
  srcHas("scripts/generate_sections.py", "fix_draw_god_activity", "SOURCE NOV5 v26 draw-God swap");
  srcHas("scripts/generate_sections.py", "draw-God activity swapped to Jesus", "SOURCE NOV5 v26 draw-God repair log");
  srcHas("scripts/generate_sections.py", "_quote_retry", "SOURCE NOV5 v26 quote retry");
  srcHas("scripts/generate_sections.py", "_first_short_sentence", "SOURCE NOV5 v26 quote code fallback");
  srcHas("scripts/generate_sections.py", "using at least one of these words from the verse", "SOURCE NOV5 v26 kid title verse words");
  srcHas("scripts/generate_sections.py", "for title_attempt in range(3)", "SOURCE NOV5 v26 kid title three attempts");
  srcNotHas("scripts/generate_sections.py", '"jesus", "christ", "magic"', "SOURCE NOV5 v26 Jesus out of title ban");
  srcHas("scripts/generate_sections.py", "BANNED_TITLE_WORDS = set([\"magic\"", "SOURCE NOV5 v26 title ban keeps magic");
  srcHas("scripts/generate_sections.py", "_prev = attempts_path.read_text", "SOURCE NOV5 v26 attempts history kept");
  srcHas("lib/quality.mjs", "son of man", "SOURCE NOV5 v26 Son of Man gate");
  srcHas("lib/quality.mjs", "Son of God, or Son of Man", "SOURCE NOV5 v26 adult gate wording");
  srcHas("components/ReviewPage.js", '"review.quoteMarksNote"', "SOURCE NOV5 v26 quote hint"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", "Quotation marks are added automatically", "SOURCE NOV5 v26 quote hint English kept"); // v63
  srcHas("components/ReviewPage.js", "stripQuoteMarks", "SOURCE NOV5 v26 quote strip helper");
  srcHas("components/ReviewPage.js", '"review.ownNoteHeading"', "SOURCE NOV5 v26 cover note section"); // v63: wording moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.ownNoteHeading": "Your own note"', "SOURCE NOV5 v26 cover note section English kept"); // v63
  srcHas("lib/pack.mjs", "stripQuotes", "SOURCE NOV5 v26 lock quote strip");

  // Nov 5, 2026, v27: Enemies pack review. The cover
  // overflowed to a blank page 2, leader textPoints came
  // back as fragments, Thursday's prayer was an
  // instruction, and the PDF download name was a job
  // number.
  srcHas("scripts/build-pdf.mjs", 'width: 22%', "SOURCE NOV5 v27 Flockpath logo smaller");
  srcHas("scripts/build-pdf.mjs", 'width: 24%', "SOURCE NOV5 v27 church logo smaller");
  srcHas("scripts/build-pdf.mjs", "#v(0.6em)", "SOURCE NOV5 v27 cover gaps tighter");
  srcHas("scripts/generate_sections.py", "starting with 'Point to' or 'Look at'", "SOURCE NOV5 v27 textPoint prompt");
  srcHas("scripts/generate_sections.py", "drop_note_fragment", "SOURCE NOV5 v27 fragment drop");
  srcHas("lib/quality.mjs", "prayer does not address God", "SOURCE NOV5 v27 prayer address warning");
  srcHas("lib/pack.mjs", "pdfFileName", "SOURCE NOV5 v27 PDF download name");
  srcHas("app/api/packs/pdf-file/route.js", "downloadName", "SOURCE NOV5 v27 download name header");

  // Nov 5, 2026, v28: verse ranges as one unit, the
  // friendly share link, and the PDF verse shortening.
  srcHas("scripts/extract_refs.py", 'kind": "range"', "SOURCE NOV5 v28 range kept as one unit");
  srcHas("lib/extract.mjs", 'kind: "range"', "SOURCE NOV5 v28 app extractor keeps a range as one unit");
  srcHas("scripts/extract_refs.py", 'r["kind"] in ("verse", "range")', "SOURCE NOV5 v28 range counts as a day");
  srcHas("lib/refs.mjs", "rangeVerses", "SOURCE NOV5 v28 range expansion");
  srcHas("lib/refs.mjs", "resolveRefText", "SOURCE NOV5 v28 joined range text");
  srcHas("lib/pack.mjs", "packSlug", "SOURCE NOV5 v28 friendly slug");
  srcHas("lib/pack.mjs", "resolvePackId", "SOURCE NOV5 v28 slug resolves to the job id");
  srcHas("app/api/generate/route.js", "(-\\d+)?", "SOURCE NOV5 v28 range counts as one of the 5 refs");
  srcHas("components/InputPage.js", "(?:-\\d+)?", "SOURCE NOV5 v28 input parses a range");
  srcHas("components/InputPage.js", 'r.kind !== "verse" && r.kind !== "range"', "SOURCE NOV5 v28 picker enables a range");
  srcHas("components/InputPage.js", 'r.kind === "range" ? t("input.kindPassage") : r.kind', "SOURCE NOV5 v28 picker shows passage not range"); // v63: the "passage" label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"input.kindPassage": "passage"', "SOURCE NOV5 v28 picker shows passage not range English kept"); // v63
  srcHas("lib/extract.mjs", "Passage over 10 verses", "SOURCE NOV5 v28 note says passage");
  srcHas("lib/generate.mjs", "resolveRefText", "SOURCE NOV5 v28 expandDraft fills a range");
  srcHas("scripts/generate_from_plan.py", "raise RuntimeError(out.stderr", "SOURCE NOV5 v28 pipeline step shows its own error");
  srcHas("components/InputPage.js", '"input.packNameLabel"', "SOURCE NOV5 v28 build step says Name for the pack"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"input.packNameLabel": "Name for the pack"', "SOURCE NOV5 v28 build step says Name for the pack English kept"); // v63

  // Nov 5, 2026, v29: the application anchor.
  srcHas("scripts/generate_sections.py", "must use at least one key word from the verse", "SOURCE NOV5 v29 bodyToday requires verse anchoring");
  srcHas("scripts/generate_sections.py", "verse_word_overlap_count", "SOURCE NOV5 v29 anchor count helper");
  srcHas("scripts/generate_sections.py", "rule: adult-today-anchor", "SOURCE NOV5 v29 anchor repair rule");
  srcHas("scripts/generate_sections.py", "Anchor this paragraph in the verse", "SOURCE NOV5 v29 anchor repair names verse words");
  srcHas("lib/quality.mjs", "application paragraph does not use any word", "SOURCE NOV5 v29 review warns on unanchored application");

  // Nov 5, 2026, v30: the prayer structure and the
  // example copy.
  // v31 superseded the v30 address wording with P.A.T.H.;
  // the prompt still addresses God by name (Praise).
  srcHas("scripts/generate_sections.py", "address God by name and praise His greatness", "SOURCE NOV5 v30 prayer prompt names the address");
  srcHas("scripts/generate_sections.py", "Close with 'In Jesus' name, Amen.'", "SOURCE NOV5 v30 prayer prompt requires Amen");
  srcHas("scripts/generate_sections.py", "prayer does not address God", "SOURCE NOV5 v30 generation checks the prayer address");
  srcHas("scripts/generate_sections.py", "copies a sentence from the length example", "SOURCE NOV5 v30 sentence-level example check");
  srcHas("lib/quality.mjs", "prayer does not address God", "SOURCE NOV5 v30 review requires a real prayer address");
  srcHas("lib/quality.mjs", "prayer does not end with Amen", "SOURCE NOV5 v30 review requires Amen");

  // Nov 5, 2026, v31: the P.A.T.H. prayer.
  srcHas("scripts/generate_sections.py", "Use the P.A.T.H. shape", "SOURCE NOV5 v31 prayer prompt uses P.A.T.H.");
  srcHas("scripts/generate_sections.py", "prayer_path_parts", "SOURCE NOV5 v31 P.A.T.H. part detection");
  // Nov 11, 2026, v53: the message is now wrapped in the
  // language helper _iss(en, es), so the pin is the message
  // text, not the old bare append.
  srcHas("scripts/generate_sections.py", 'f"prayer is missing {_m}"', "SOURCE NOV5 v31 generation flags each missing P.A.T.H. part");
  srcHas("lib/quality.mjs", "P.A.T.H.", "SOURCE NOV5 v31 review warns on missing P.A.T.H. parts");

  // Nov 5, 2026, v32: the P.A.T.H. label echo and Rewrite.
  srcHas("scripts/generate_sections.py", "say 'Forgive us for...', not 'Apologize for...'", "SOURCE NOV5 v32 prayer prompt gives the natural words");
  srcHas("scripts/generate_sections.py", "prayer uses the label 'Apologize' instead of asking forgiveness", "SOURCE NOV5 v32 generation flags the Apologize label");
  srcHas("lib/quality.mjs", 'label "Apologize"', "SOURCE NOV5 v32 review warns on the Apologize label");
  srcHas("app/api/rewrite/route.js", "Rewrite recorded only", "SOURCE NOV5 v32 rewrite API route");
  srcHas("scripts/generate_worker.py", "queued_rewrites", "SOURCE NOV5 v32 worker handles rewrite requests");
  srcHas("scripts/rewrite_section.py", "has_verbatim_run", "SOURCE NOV5 v32 rewrite script checks verbatim");
  srcHas("components/ReviewPage.js", '"review.rewriteButton"', "SOURCE NOV5 v32 ReviewPage has a Rewrite button"); // v63: label moved to the app-language dictionary (lib/appStrings.mjs)
  srcHas("lib/appStrings.mjs", '"review.rewriteButton": "Rewrite this section"', "SOURCE NOV5 v32 ReviewPage has a Rewrite button English kept"); // v63
  srcHas("app/pack/[id]/page.js", "packSlug", "SOURCE NOV5 v28 share link friendly");
  srcHas("app/packs/page.js", "packSlug", "SOURCE NOV5 v28 library share link friendly");
  srcHas("components/ReviewPage.js", "packSlug", "SOURCE NOV5 v28 review share link friendly");
  srcHas("scripts/build-pdf.mjs", "shortenVerse", "SOURCE NOV5 v28 PDF verse shortening");
  srcHas("scripts/build-pdf.mjs", "VERSE_PRINT_MAX", "SOURCE NOV5 v28 overflow check threshold");
} finally {
  await cleanup();
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
