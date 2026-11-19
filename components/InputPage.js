"use client";
import { useState, useEffect, useRef } from "react";

import JourneyStrip from "./JourneyStrip";
import { BOOK_NAMES, formatRef } from "../lib/refs.mjs";

// Step 7.5 Phase D, step 2: pastor input front door, with
// confirm-or-correct BEFORE anything is generated.
// One door: sermon paste, verse list, topic, or a .txt/.md/.pdf file.
// The server extracts refs by regex only, never by model guess,
// and returns them for the pastor to check. The pastor can
// uncheck a ref, or type a corrected list, before confirming.
// Confirming does not generate a pack yet. Generation from a
// confirmed plan is the next Phase D step, and it will use
// only the confirmed refs.
//
// Nov 4, 2026, pastor walkthrough (Mac pastor-role test items
// 9, 10, 12, 13, 14, 15, 16): the old page showed everything
// at once, the picked-refs button seemed dead while it acted
// far above the button, repeat clicks duplicated refs, the
// job line showed a job number instead of the pack name, the
// build status was small print at the bottom, and the status
// copy was coder speak. Now the page walks one step at a
// time: 1 where to start, 2 check the verses, 3 name it and
// build. Picked refs dedupe and confirm inline, the job line
// shows the pack name, the build status is a big banner at
// the top while a build runs, and every status line is
// worded for a pastor, not a coder.
//
// Nov 5, 2026, fresh-eyes test: a failed build showed only
// "Building stopped before it finished. Tap Continue below
// to pick up where it left off." The job file already
// carries the reason (job.error, saved by the worker), but
// the page never showed it, so a pastor could tap Continue
// forever on a failure no retry can fix (a missing model
// piece on this computer). Now the page says why it stopped
// in plain words, and Continue is offered only when a retry
// could actually help. A setup failure names the missing
// piece and the fix instead.
function plainFailureReason(error) {
  const e = String(error || "");
  const missing = e.match(/No module named '([^']+)'/i);
  if (missing) return { setup: true, text: `Building stopped because the app could not start its writing model: a piece is missing on this computer (${missing[1]}). Restart the app from the start script. If it still stops, run the setup steps again to install the missing piece.` };
  if (/no such file.*\.gguf|failed to load.*model|model file.*(not found|missing)/i.test(e)) return { setup: true, text: "Building stopped because the app could not find or start its writing model file. Restart the app from the start script. If it still stops, the model file needs to be put back where the app expects it." };
  const last = e.trim().split("\n").filter(Boolean).pop() || "";
  if (last) return { setup: false, text: `Building stopped because: ${last.slice(0, 200)} Tap Continue below to pick up where it left off.` };
  return { setup: false, text: "Building stopped before it finished, for a reason the app could not explain. Tap Continue below to pick up where it left off, and if it stops again, the details are in the app log." };
}

// Nov 12, 2026, v55: the build checklist mirrors the worker's
// own step list (scripts/generate_from_plan.py +
// generate_sections.py): 1 Gathering study material from Phos,
// 2 Finding the week's angles (only when angles are derived:
// the total tells us, base = total - 2N - 3), then Building
// <Day> / Building <Day> for kids per day, Writing leader
// questions, Matching a hymn, Finishing the draft. Display
// only: the labels are copied from the worker, never invented.
const BUILD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function buildStepLabels(progress, refs) {
  const total = progress?.total ?? 0;
  const n = Array.isArray(refs) && refs.length ? refs.length : 5;
  const base = total ? total - 2 * n - 3 : 2;
  const labels = ["Gathering study material from Phos"];
  if (base !== 1) labels.push("Finding the week's angles");
  for (let i = 0; i < n; i++) {
    labels.push(`Building ${BUILD_DAYS[i]}`);
    labels.push(`Building ${BUILD_DAYS[i]} for kids`);
  }
  labels.push("Writing leader questions", "Matching a hymn", "Finishing the draft");
  return labels;
}

function BuildRing({ progress, status }) {
  const total = progress.total || 1;
  const done = status === "ready_for_review" || status === "done" ? total : Math.max(0, (progress.step || 1) - 1);
  const pct = Math.round((done / total) * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="fp-ring-wrap">
      <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`${pct}% built`}>
        <circle cx="52" cy="52" r={r} fill="none" stroke="#e9e2cf" strokeWidth="10" />
        <circle cx="52" cy="52" r={r} fill="none" stroke="#679357" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} transform="rotate(-90 52 52)" />
        <text x="52" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill="#121f3d">{pct}%</text>
        <text x="52" y="68" textAnchor="middle" fontSize="11" fill="#6b6558">built</text>
      </svg>
      <p className="fp-ring-label">Step {progress.step} of {total}</p>
    </div>
  );
}

function BuildChecklist({ progress, refs, status }) {
  const labels = buildStepLabels(progress, refs);
  const finished = status === "ready_for_review" || status === "done";
  const current = finished ? labels.length + 1 : progress.step;
  return (
    <ol className="fp-checklist">
      {labels.map((label, i) => {
        const stepNo = i + 1;
        const state = finished || stepNo < current ? "done" : stepNo === current ? "now" : "next";
        return (
          <li key={stepNo} className={state === "done" ? "fp-check-done" : state === "now" ? "fp-check-now" : "fp-check-next"}>
            <span className={state === "done" ? "fp-check" : state === "now" ? "fp-check-now" : ""} aria-hidden="true">{state === "done" ? "\u2713" : state === "now" ? "\u25B6" : "\u25CB"}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export default function InputPage({ initialTopic, initialJobId }) {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [result, setResult] = useState(null);
  const [kept, setKept] = useState([]);
  const [status, setStatus] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  // Nov 11, 2026, v54, Phase 4 flexible length: the pastor
  // picks 3, 5, or 7 days. 5 is the default, so a pack built
  // exactly as before needs no new choice. The count rides
  // to extract (so the proposal matches) and to confirm
  // (so the plan is exactly that many refs).
  const [dayCount, setDayCount] = useState(5);
  // Nov 11, 2026, v54, Phase 4 YouTube import: a sermon link
  // fetches the sermon's words into the textarea below, the
  // same as pasting them by hand. Captions first (seconds);
  // a full transcription takes several minutes for a long
  // sermon. The pastor checks the text and presses Extract
  // refs as usual: the import never picks the verses.
  const [ytUrl, setYtUrl] = useState("");
  const [ytStatus, setYtStatus] = useState("");
  const [ytBusy, setYtBusy] = useState(false);
  async function onYoutubeImport(e) {
    e.preventDefault();
    if (!ytUrl.trim() || ytBusy) return;
    setYtBusy(true);
    setYtStatus("Importing from YouTube... captions take seconds; a full transcription takes several minutes for a long sermon. Keep this page open.");
    try {
      const res = await fetch("/api/youtube-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: ytUrl, language }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || "The import failed.");
      setText(data.text);
      setYtStatus(`Imported ${Number(data.chars || 0).toLocaleString()} characters from "${data.title || "this video"}" (${data.source === "captions" ? "captions" : "transcribed audio"}). Check the text below, then press Extract refs as usual.`);
    } catch (err) {
      setYtStatus(err.message || "The import failed.");
    }
    setYtBusy(false);
  }
  const [topicResult, setTopicResult] = useState(null);
  const [topicPicked, setTopicPicked] = useState([]);
  const [topicMessage, setTopicMessage] = useState("");
  const [genJob, setGenJob] = useState(null);
  const [genPassage, setGenPassage] = useState("");
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [failedSetup, setFailedSetup] = useState(false);
  // Nov 11, 2026, v53, Phase 3 Spanish v1: the language
  // picker (English + Spanish) and the translation picker
  // (Reina-Valera 1909 / Español Sencillo 2026) for Spanish
  // packs. English always uses the Berean Standard Bible.
  // Both ride to /api/generate with the job, and the plan
  // carries them to the worker.
  const [language, setLanguage] = useState("en");
  const [translation, setTranslation] = useState("bsb");
  // Nov 11, 2026, v52, Phase 2 member mode: the copy on
  // this page is member-aware. A member builds a study
  // for themselves, not a pack for a congregation, and
  // nothing is ever locked or approved here. The role
  // comes from /api/me, which reads the signed-in account.
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setIsMember(data.role === "member"); })
      .catch(() => {});
  }, []);

  // Nov 12, 2026, v55: deep links from the Dashboard.
  // ?job=<id> reloads that build's status panel; ?topic=<name>
  // fills the topic and runs the Phos search once, so a
  // suggested pack starts searching. Runs once per mount.
  const deepLinkRan = useRef(false);
  useEffect(() => {
    if (deepLinkRan.current) return;
    deepLinkRan.current = true;
    if (initialJobId) {
      fetch(`/api/generate?id=${initialJobId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setGenJob(data.job);
            try { localStorage.setItem("flockpath-active-job", data.job.id); } catch {}
          }
        })
        .catch(() => {});
    }
    if (initialTopic) onTopicSearch(null, initialTopic);
  }, []);

  // Nov 3, 2026, generation step display: while a job is
  // queued or running, refresh its status on its own every
  // 15 seconds, so the pastor sees the current step without
  // tapping Check job status. Manual check still works.
  useEffect(() => {
    if (!genJob?.id) return undefined;
    if (genJob.status !== "queued" && genJob.status !== "running") return undefined;
    const timer = setInterval(() => { onCheckJob(); }, 15000);
    return () => clearInterval(timer);
  }, [genJob?.id, genJob?.status]);

  // Nov 5, 2026, round-2 stay-or-leave fix: the old page
  // kept the job only in memory, so leaving the page lost
  // the status view even though the worker kept building.
  // The active job id now persists in the browser, and a
  // return visit reloads that job's status. Leaving cannot
  // double-start or orphan a job: jobs run server-side,
  // and Continue is guarded to running, failed, or
  // interrupted jobs only.
  useEffect(() => {
    const savedId = localStorage.getItem("flockpath-active-job");
    if (!savedId) return;
    fetch(`/api/generate?id=${savedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setGenJob(data.job);
        else localStorage.removeItem("flockpath-active-job");
      })
      .catch(() => {});
  }, []);

  async function onGenerate() {
    if (!confirmed?.complete) return;
    const passage = genPassage.trim() || topic.trim();
    if (!passage) { setStatus("Type a passage name for this pack first, for example Romans 8."); return; }
    setStatus("Starting your pack build...");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passage, refs: confirmed.plan, topics: topic ? [topic] : [], sermonText: text, language, translation }),
    });
    const data = await res.json();
    if (!data.ok && data.error) { setStatus(data.error); return; }
    setGenJob(data.job);
    try { localStorage.setItem("flockpath-active-job", data.job.id); } catch {}
    setStatus("Your pack is building. See the status panel below; it is not finished yet.");
  }

  // Nov 5, 2026, round-2 instant feedback: the old Check
  // button went silent until the fetch returned, so a tap
  // felt dead. A manual tap now answers at once: the
  // button itself says Checking, and the panel records
  // the last check time. A running build's step line
  // lives in the panel itself, not in the status line.
  // The 15-second auto-poll stays silent: it refreshes
  // the panel without flashing feedback.
  async function onCheckJob(manual = false) {
    if (!genJob?.id) return;
    if (manual) { setChecking(true); setStatus("Checking build status..."); }
    try {
      const res = await fetch(`/api/generate?id=${genJob.id}`);
      const data = await res.json();
      if (!data.ok) { setStatus(data.error || "That build was not found."); return; }
      setGenJob(data.job);
      const j = data.job;
      if (manual) setLastChecked(new Date());
      if (j.status !== "failed") setFailedSetup(false);
      if (j.status === "done") setStatus(`Finished. "${jobName(j)}" is in your library.`);
      else if (j.status === "ready_for_review") setStatus(isMember ? "Ready for your review. It is a draft, not a saved study, until you review it and save it." : "Ready for your review. It is a draft, not a locked pack, until you approve it.");
      else if (j.status === "failed") {
        const r = plainFailureReason(j.error);
        setFailedSetup(r.setup);
        setStatus(r.text);
      }
      else if (manual) setStatus("Still building. The status panel below shows the current step.");
    } finally {
      if (manual) setChecking(false);
    }
  }

  async function onContinueJob() {
    if (!genJob?.id) return;
    setStatus("Continuing this build from its last finished section...");
    const res = await fetch("/api/generate/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: genJob.id }),
    });
    const data = await res.json();
    if (!data.ok) { setStatus(data.error || "Could not continue this build."); return; }
    setGenJob(data.job);
    try { localStorage.setItem("flockpath-active-job", data.job.id); } catch {}
    setStatus("Continued. Finished days are kept, only the missing ones are built.");
  }

  async function onTopicSearch(e, topicOverride) {
    if (e) e.preventDefault();
    const q = (topicOverride ?? topic).trim();
    if (topicOverride) setTopic(topicOverride);
    if (!q) { setStatus("Type a topic first, for example grace."); return; }
    setStatus("Searching Phos for this topic...");
    setTopicResult(null);
    setTopicPicked([]);
    setTopicMessage("");
    const res = await fetch("/api/topic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: q }),
    });
    const data = await res.json();
    if (!data.ok && data.error) { setStatus(data.error); return; }
    setTopicResult(data);
    setStatus(data.message);
  }

  function toggleTopic(ref) {
    setTopicPicked((p) => p.includes(ref) ? p.filter((r) => r !== ref) : [...p, ref]);
  }

  // Nov 4, 2026, picked-refs fix (Mac test item 9): the old
  // button appended blindly, so repeat clicks duplicated
  // refs, and the only visible change was far up the page.
  // Now refs already in the verse list are skipped, the
  // picked boxes clear after use (so a second click cannot
  // re-add them), and the confirmation shows right here,
  // next to the button that was tapped.
  function refForms(ref) {
    // v28, Nov 5, 2026: a range (Matthew 28:18-20) is one
    // passage unit, so the form matcher allows a range too.
    const m = String(ref).trim().match(/^(.*?)\s+(\d+:\d+(?:-\d+)?)$/);
    if (!m) return [String(ref).trim()];
    const book = m[1].trim();
    const code = Object.keys(BOOK_NAMES).find((c) => BOOK_NAMES[c].toLowerCase() === book.toLowerCase()) || book.toUpperCase();
    const forms = [`${code} ${m[2]}`, `${BOOK_NAMES[code] || book} ${m[2]}`];
    return [...new Set(forms)];
  }

  function useTopicRefs() {
    if (!topicPicked.length) { setTopicMessage("Pick at least one suggested passage first."); return; }
    const lower = text.toLowerCase();
    const fresh = topicPicked.filter((r) => !refForms(r).some((f) => lower.includes(f.toLowerCase())));
    if (!fresh.length) {
      setTopicPicked([]);
      setTopicMessage("Those passages are already in your verse list above.");
      return;
    }
    setText((t) => (t ? `${t}\n` : "") + fresh.join(", "));
    setTopicPicked([]);
    setTopicMessage(`Added ${fresh.join(", ")} to your verse list above. Press Extract refs to check them.`);
  }

  async function onExtract(e) {
    e.preventDefault();
    setStatus("Extracting refs...");
    setResult(null);
    setConfirmed(null);
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, dayCount }),
    });
    const data = await res.json();
    if (!data.ok && data.error) { setStatus(data.error); return; }
    setResult(data);
    setKept(data.verseRefs);
    setStatus(data.message);
    setStep(2);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.pdf$/i.test(file.name)) {
      setStatus(`Reading ${file.name}...`);
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) { setStatus(data.error || "Could not read this PDF."); return; }
      setText(data.text);
      setStatus(`Loaded ${file.name}: ${data.pages} page${data.pages === 1 ? "" : "s"}, ${data.chars} characters. Press Extract refs to check it. The file itself is not stored.`);
      return;
    }
    if (!/\.txt$|\.md$/i.test(file.name)) {
      setStatus("Only .txt, .md, or .pdf files are accepted. A scanned-image PDF has no text to extract.");
      return;
    }
    setText(await file.text());
    setStatus(`Loaded ${file.name}. Press Extract refs to check it.`);
  }

  function toggle(ref) {
    setKept((k) => k.includes(ref) ? k.filter((r) => r !== ref) : [...k, ref]);
  }

  function onConfirm() {
    const plan = kept.slice(0, dayCount);
    setConfirmed({
      refs: kept,
      plan,
      complete: plan.length === dayCount,
    });
    setStatus(plan.length === dayCount
      ? "Confirmed. This plan is ready for the last step."
      : `Confirmed, but under ${dayCount} verses. Add verses before building, the tool will not pad the plan.`);
    if (plan.length === dayCount) setStep(3);
  }

  // The pastor-facing name for a job: the passage name they
  // chose, never the job number. The number stays in code
  // and logs only (Mac test items 13, 14).
  function jobName(j) {
    return j?.plan?.passage || genPassage || topic || "this pack";
  }

  function jobStatusWords(j) {
    if (!j) return "";
    if (j.status === "queued") return "Waiting to start";
    if (j.status === "running") return "Building now";
    if (j.status === "ready_for_review") return "Ready for your review";
    if (j.status === "done") return "Finished";
    if (j.status === "failed") return "Stopped";
    return j.status;
  }

  // Nov 4, 2026, time-left estimate (Mac test item 16):
  // average time per finished section, times the sections
  // left. Labeled an estimate, shown only once at least one
  // section has finished, so the average means something.
  // Nov 5, 2026, round-3: a build is a few minutes on a
  // newer machine with graphics acceleration, and up to
  // 30 minutes on an older computer (the Nov 4 Mac speed
  // run finished a full pack in about 3 minutes). Sections
  // vary, so this is a guide, not a promise.
  function timeLeft(j) {
    if (!j?.progress || j.status !== "running" || !j.createdAt) return "";
    const done = j.progress.step - 1;
    if (done < 1) return "";
    const elapsed = Date.now() - new Date(j.createdAt).getTime();
    if (!(elapsed > 0)) return "";
    const left = (elapsed / done) * (j.progress.total - j.progress.step + 1);
    const mins = Math.max(1, Math.round(left / 60000));
    return `About ${mins} minute${mins === 1 ? "" : "s"} left (estimate).`;
  }

  const jobActive = genJob && ["queued", "running"].includes(genJob.status);
  const jobDone = genJob && ["ready_for_review", "done", "failed"].includes(genJob.status);
  // Nov 11, 2026, v52: a member's journey ends at saving
  // and printing, never at sharing, so a finished member
  // build sits at the save stage, not the share stage.
  const journeyStage = !genJob ? "start" : (genJob.status === "queued" || genJob.status === "running" || genJob.status === "failed") ? "building" : genJob.status === "ready_for_review" ? "review" : isMember ? "save" : "share";

  return (
    <main className="fp-main">
      <JourneyStrip stage={journeyStage} member={isMember} />
      <h1>Start a pack</h1>
      {isMember ? (
        <p>Three steps, one at a time: what the study is about, which verses it uses, then its name and build. Nothing is saved until you review it and save it as your personal study.</p>
      ) : (
        <p>Three steps, one at a time: what the pack is about, which verses it uses, then its name and build.</p>
      )}

      {step === 1 && (
        <section>
          <h2>Step 1 of 3: What is this pack about?</h2>
          <section className="fp-card">
            <h3 style={{ marginTop: 0 }}>How it will work</h3>
            <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              <li>You give the passage: a sermon, a verse list, or a topic.</li>
              <li>You check the verses. Nothing builds until you confirm them.</li>
              <li>Flockpath writes one day at a time, then you review and approve it.</li>
            </ol>
            <p style={{ marginBottom: 0 }}>~10 minutes with OpenRouter, Grok, or Google, or up to 30 minutes with the local model on an older computer. About a penny a family per week on OpenRouter.</p>
          </section>
          <div className="fp-card">
            <h3 style={{ marginTop: 0 }}>Language and Bible translation</h3>
            <p>
              <label><input type="radio" name="pack-language" checked={language === "en"} onChange={() => { setLanguage("en"); setTranslation("bsb"); }} /> English</label>{" "}
              <label><input type="radio" name="pack-language" checked={language === "es"} onChange={() => { setLanguage("es"); setTranslation("rv1909"); }} /> Español</label>
            </p>
            {language === "es" ? (
              <>
                <p>
                  <label><input type="radio" name="pack-translation" checked={translation === "rv1909"} onChange={() => setTranslation("rv1909")} /> Reina-Valera 1909 (public domain)</label>{" "}
                  <label><input type="radio" name="pack-translation" checked={translation === "spabes"} onChange={() => setTranslation("spabes")} /> La Biblia en Español Sencillo 2026 (public domain)</label>
                </p>
                <p>Both Spanish texts are in the public domain. The pack is written in Spanish, and every verse is filled in from the Spanish Bible text you pick here, never written by the model. Topic search below is in English (Phos is an English library); you can still paste Spanish verses directly, with or without accents, for example Génesis 1:1 or Salmos 23:1.</p>
              </>
            ) : (
              <p>English packs use the Berean Standard Bible (public domain). Every verse is filled in from that text, never written by the model.</p>
            )}
          </div>
          {isMember ? (
            <p>Paste a sermon, a verse list, or a passage. The tool finds the verse references in what you pasted, shows them back, and you correct them before anything is built. A topic alone never builds a study: search a topic, pick passages from Phos, then extract and confirm them. If you paste a whole sermon, the cover will carry a short summary and one quote from it. If you start from a topic instead, you can still add your own short note for the cover on the review page.</p>
          ) : (
            <p>Paste your sermon, a verse list, or a passage. The tool finds the verse references in what you pasted, shows them back, and you correct them before anything is built. A topic alone never builds a pack: search a topic, pick passages from Phos, then extract and confirm them. If you paste your whole sermon, the cover will carry a short summary and one quote from it. If you start from a topic instead, you can still add your own short note for the cover on the review page.</p>
          )}
          <form onSubmit={onExtract}>
            <p style={{ marginBottom: 4 }}><strong>Suggested topics</strong> - tap one to search Phos for it:</p>
            <div className="fp-chip-row">
              {["Forgiveness", "Grace", "Psalm 23", "The Power of the Cross", "Love", "Shepherd"].map((t) => (
                <button key={t} type="button" className="fp-chip" aria-pressed={topic === t} onClick={() => { setTopic(t); onTopicSearch(null, t); }}>{t}</button>
              ))}
            </div>
            <label>Topic (optional, search Phos for suggested passages)<br />
              <input value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="e.g. shepherd, grace" />
            </label>
            <p><button type="button" onClick={(e) => onTopicSearch(e)}>Search topic in Phos</button></p>
            <p><label>Sermon paste or verse list<br />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={{ width: "100%", padding: 8 }} placeholder={language === "es" ? "Juan 3:16, Salmos 23:1-3, o pega tu sermón completo aquí" : "John 3:16, Psalm 23:1-3, or paste your whole sermon here"} />
            </label></p>
            <p><label>Or upload a .txt, .md, or .pdf file: <input type="file" accept=".txt,.md,.pdf" onChange={onFile} /></label></p>
            <p>PDFs are read for their text only, then the file is deleted. A scanned-image PDF has no text to read, so paste its text instead if that happens.</p>
            <p><label>Or import a sermon from YouTube<br />
              <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="https://www.youtube.com/watch?v=..." />
            </label></p>
            <p><button type="button" onClick={onYoutubeImport} disabled={ytBusy || !ytUrl.trim()}>{ytBusy ? "Importing..." : "Import from YouTube"}</button></p>
            <p>Flockpath fetches the sermon&apos;s words from its captions first, or transcribes the audio on this computer when the video has no captions. The words land in the box above for you to check. If YouTube asks for a sign-in, paste the sermon text instead.</p>
            {ytStatus && <p><strong>{ytStatus}</strong></p>}
            <button type="submit" className="fp-btn-mobile-block">Extract refs</button>
          </form>
          {topicResult && (
            <section className="fp-card" style={{ marginTop: 16 }}>
              <h3>Suggested passages for &quot;{topicResult.topic}&quot;</h3>
              <p>Curated topical passages first, from dictionary lists in Phos. Devotional anchors second, and noisier. Pick passages, then press Use picked passages, then Extract refs. The tool never picks a passage for you.</p>
              <p>Each list shows the 25 most-cited passages for this topic. If a verse you want is not listed, type it in the verse list above and it joins the same list.</p>
              <h4>Topical passages</h4>
              {topicResult.topical.length ? (
                <ul>{topicResult.topical.map((r) => (
                  <li key={r.reference}><label><input type="checkbox" checked={topicPicked.includes(r.reference)} onChange={() => toggleTopic(r.reference)} /> {formatRef(r.reference)} (in {r.count} dictionary {r.count === 1 ? "entry" : "entries"})</label></li>
                ))}</ul>
              ) : <p>No dictionary entry lists verses for this word.</p>}
              <h4>Devotional anchors (secondary)</h4>
              {topicResult.devotionalAnchors.length ? (
                <ul>{topicResult.devotionalAnchors.map((r) => (
                  <li key={r.reference}><label><input type="checkbox" checked={topicPicked.includes(r.reference)} onChange={() => toggleTopic(r.reference)} /> {formatRef(r.reference)} ({r.count} devotional{r.count === 1 ? "" : "s"}, e.g. {r.example})</label></li>
                ))}</ul>
              ) : <p>No devotional anchor found for this word.</p>}
              <button type="button" onClick={useTopicRefs}>Use picked passages</button>
              {topicMessage && <p><strong>{topicMessage}</strong></p>}
            </section>
          )}
        </section>
      )}

      {step === 2 && result && (
        <section>
          <h2>Step 2 of 3: Which verses should it use?</h2>
          <p>Uncheck any passage that should not be in the pack. The plan below uses only the checked passages, in order.</p>
          <ul>
            {result.refs.map((r, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" disabled={r.kind !== "verse" && r.kind !== "range"} checked={(r.kind === "verse" || r.kind === "range") ? kept.includes(r.reference) : false} onChange={() => toggle(r.reference)} />
                  {" "}{formatRef(r.reference, language)} ({r.kind === "range" ? "passage" : r.kind}){r.note ? ` - ${r.note}` : ""}
                </label>
              </li>
            ))}
          </ul>
          <h3>How long should this pack run?</h3>
          <p>
            {[3, 5, 7].map((n) => (
              <label key={n} style={{ marginRight: 16 }}>
                <input type="radio" name="dayCount" checked={dayCount === n} onChange={() => setDayCount(n)} /> {n} days{n === 3 ? " (Mon-Wed, a short week)" : n === 5 ? " (Mon-Fri, the usual week)" : " (Mon-Sun, the full week)"}
              </label>
            ))}
          </p>
          <h3>Proposed {dayCount}-day plan, from checked passages</h3>
          <ol>{kept.slice(0, dayCount).map((r) => <li key={r}>{formatRef(r, language)}</li>)}</ol>
          {kept.length > dayCount && <p>Only the first {dayCount} checked passages are used in the plan.</p>}
          {kept.length < dayCount && <p>Add verses to reach {dayCount}. The tool will not invent the missing days.</p>}
          <p><button onClick={onConfirm}>Confirm these passages</button> <button type="button" onClick={() => setStep(1)}>Back to step 1</button></p>
        </section>
      )}
      {step === 2 && !result && (
        <section>
          <h2>Step 2 of 3: Which verses should it use?</h2>
          <p>No verses extracted yet. Go back to step 1 and press Extract refs.</p>
          <p><button type="button" onClick={() => setStep(1)}>Back to step 1</button></p>
        </section>
      )}

      {step === 3 && confirmed && (
        <section>
          <h2>Step 3 of 3: What should it be called?</h2>
          <p>Topic: {topic || "(none given)"}</p>
          <ol>{confirmed.plan.map((r) => <li key={r}>{formatRef(r, language)}</li>)}</ol>
          <p>{confirmed.complete ? "Ready to build. When it runs, building a pack takes ~10 minutes with OpenRouter, Grok, or Google, or up to 30 minutes with the local model on an older computer, because the model writes each day separately and every verse is checked before locking." : `Under ${dayCount} verses. Building waits until the plan is complete.`}</p>
          {confirmed.complete && (
            <div className="fp-card" style={{ marginTop: 16 }}>
              <h3>Build this pack</h3>
              <label>Name for the pack<br />
                <input value={genPassage} onChange={(e) => setGenPassage(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="e.g. Romans 8" />
              </label>
              <p><button type="button" className="fp-btn-mobile-block" onClick={onGenerate} disabled={jobActive}>Start building this pack</button></p>
              {jobActive && <p>A build is already running. See the status panel below.</p>}
              <p>What happens when you tap this button: Flockpath starts building your pack. It writes one day at a time and checks every verse, so most packs take ~10 minutes with OpenRouter, Grok, or Google, and up to 30 minutes with the local model on an older computer. With OpenRouter, Grok, or Google the writing happens through that provider&apos;s service; with Local it happens here on your computer. You can leave this page and come back; when the draft is ready it waits for your review, and {isMember ? "nothing is saved until you review it and save it as your personal study." : "nothing locks until you approve it."}</p>
              {jobDone && (
                <p>
                  {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>{isMember ? "Review this draft" : "Review and approve this draft"}</a>}
                  {genJob.packId && <> <a href={`/pack/${genJob.packId}`}>Open the finished pack</a> | <a href={`/api/packs/pdf-file?id=${encodeURIComponent(genJob.packId)}`}>Download print PDF</a></>}
                  {!genJob.packId && genJob.pdf && <> <a href={genJob.pdf}>Download print PDF</a></>}
                </p>
              )}
              <p>If building stops before it finishes, tap Continue from last finished section in the status panel below. It does not start over: finished days and questions are kept, only the missing sections are built.</p>
            </div>
          )}
          <p><button type="button" onClick={() => setStep(2)}>Back to step 2</button></p>
        </section>
      )}
      {step === 3 && !confirmed && (
        <section>
          <h2>Step 3 of 3: What should it be called?</h2>
          <p>No confirmed plan yet. Go back and confirm your verses first.</p>
          <p><button type="button" onClick={() => setStep(2)}>Back to step 2</button></p>
        </section>
      )}

      {/* Nov 5, 2026, round-2 task order: the build status
      used to sit above the steps while the Build
      button sat at the bottom of step 3, so a pastor went
      top, then bottom, then top again to follow a build.
      The status line and the panel now sit below the step
      content, in flow, so the next thing is always the
      next thing down the page, never a jump back up. */}
      {status && <p><strong>{status}</strong></p>}

      {genJob && (
        <section className="fp-build-panel" aria-label="Build progress">
          <h2 style={{ marginTop: 0, fontSize: 24 }}>
            {genJob.status === "running" || genJob.status === "queued" ? "Your pack is being built!" : genJob.status === "ready_for_review" ? "Your pack is ready for review!" : genJob.status === "done" ? "Your pack is finished!" : "Building stopped."}
          </h2>
          <div className="fp-build-top">
            {genJob.progress && <BuildRing progress={genJob.progress} status={genJob.status} />}
            <div style={{ flex: "1 1 300px" }}>
              <p style={{ fontSize: 18, marginTop: 0 }}><strong>&ldquo;{jobName(genJob)}&rdquo;</strong> - {jobStatusWords(genJob)}.</p>
              {genJob.progress && (genJob.status === "queued" || genJob.status === "running") && (
                <p style={{ fontSize: 17 }}>Step {genJob.progress.step} of {genJob.progress.total}: {genJob.progress.label}.</p>
              )}
              {timeLeft(genJob) && <p style={{ fontSize: 16 }}>{timeLeft(genJob)}</p>}
            </div>
          </div>
          {genJob.progress && <BuildChecklist progress={genJob.progress} refs={genJob.plan?.refs} status={genJob.status} />}
          <p>
            <button type="button" className="fp-btn-mobile-block" onClick={() => onCheckJob(true)} disabled={checking} style={{ marginRight: 8 }}>{checking ? "Checking..." : "Check build status"}</button>
            {(genJob.status === "running" || (genJob.status === "failed" && !failedSetup)) && <button type="button" className="fp-btn-gold fp-btn-mobile-block" onClick={onContinueJob} style={{ marginRight: 8 }}>Continue from last finished section</button>}
            {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>{isMember ? "Review this draft" : "Review and approve this draft"}</a>}
            {genJob.packId && <> <a href={`/pack/${genJob.packId}`}>Open the finished pack</a> | <a href={`/api/packs/pdf-file?id=${encodeURIComponent(genJob.packId)}`}>Download print PDF</a></>}
            {!genJob.packId && genJob.pdf && <> <a href={genJob.pdf}>Download print PDF</a></>}
          </p>
          {lastChecked && <p>Last checked {lastChecked.toLocaleTimeString()}.</p>}
          <p>You can leave this page and come back. Your pack keeps building here on your computer, and this page picks up its status when you return.</p>
          {genJob.status === "failed" && failedSetup ? (
            <p>This stop needs a setup fix on this computer, not a retry. Restart the app from the start script, and if it still stops, run the setup steps again.</p>
          ) : (
            <p>If building stops before it finishes, tap Continue. Finished days are kept, only the missing ones are built.</p>
          )}
        </section>
      )}
    </main>
  );
}
