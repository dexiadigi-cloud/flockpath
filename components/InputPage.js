"use client";
import { useState, useEffect, useRef } from "react";

import JourneyStrip from "./JourneyStrip";
import { useAppLanguage } from "./AppLanguage";
import { t as dictT, tf } from "../lib/appStrings.mjs";
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
// Nov 21, 2026, v63 round 3: the failure wording is
// translated through the dictionary (lang is the app
// language). The embedded server error text in the
// failWithReason case stays as-is, untranslated.
function plainFailureReason(error, lang) {
  const e = String(error || "");
  const missing = e.match(/No module named '([^']+)'/i);
  if (missing) return { setup: true, text: tf(lang, "input.failMissingModule", { piece: missing[1] }) };
  if (/no such file.*\.gguf|failed to load.*model|model file.*(not found|missing)/i.test(e)) return { setup: true, text: dictT(lang, "input.failModelFile") };
  const last = e.trim().split("\n").filter(Boolean).pop() || "";
  if (last) return { setup: false, text: tf(lang, "input.failWithReason", { reason: last.slice(0, 200) }) };
  return { setup: false, text: dictT(lang, "input.failUnknown") };
}

// Nov 12, 2026, v55: the build checklist mirrors the worker's
// own step list (scripts/generate_from_plan.py +
// generate_sections.py): 1 Gathering study material from Phos,
// 2 Finding the week's angles (only when angles are derived:
// the total tells us, base = total - 2N - 3), then Building
// <Day> / Building <Day> for kids per day, Writing leader
// questions, Matching a hymn, Finishing the draft. Display
// only: the labels are copied from the worker, never invented.
// Nov 21, 2026, v63 round 3: the checklist labels are
// translated through the dictionary (lang is the app
// language). Day names come from the day.* keys, first
// letter capitalized, so Spanish shows "Lunes", not "lunes".
const BUILD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function buildStepLabels(progress, refs, lang) {
  const total = progress?.total ?? 0;
  const n = Array.isArray(refs) && refs.length ? refs.length : 5;
  const base = total ? total - 2 * n - 3 : 2;
  const labels = [dictT(lang, "input.buildGathering")];
  if (base !== 1) labels.push(dictT(lang, "input.buildAngles"));
  for (let i = 0; i < n; i++) {
    const dayRaw = dictT(lang, `day.${BUILD_DAYS[i].toLowerCase()}`);
    const day = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1);
    labels.push(tf(lang, "input.buildDay", { day }));
    labels.push(tf(lang, "input.buildDayKids", { day }));
  }
  labels.push(dictT(lang, "input.buildQuestions"), dictT(lang, "input.buildHymn"), dictT(lang, "input.buildFinish"));
  return labels;
}

function BuildRing({ progress, status, lang }) {
  const total = progress.total || 1;
  const done = status === "ready_for_review" || status === "done" ? total : Math.max(0, (progress.step || 1) - 1);
  const pct = Math.round((done / total) * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="fp-ring-wrap">
      <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={tf(lang, "input.builtAria", { pct })}>
        <circle cx="52" cy="52" r={r} fill="none" stroke="#e9e2cf" strokeWidth="10" />
        <circle cx="52" cy="52" r={r} fill="none" stroke="#679357" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} transform="rotate(-90 52 52)" />
        <text x="52" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill="#121f3d">{pct}%</text>
        <text x="52" y="68" textAnchor="middle" fontSize="11" fill="#6b6558">{dictT(lang, "input.built")}</text>
      </svg>
      <p className="fp-ring-label">{tf(lang, "input.stepOf", { step: progress.step, total })}</p>
    </div>
  );
}

function BuildChecklist({ progress, refs, status, lang }) {
  const labels = buildStepLabels(progress, refs, lang);
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
  // Nov 20, 2026, v62 (item 1): the app language, from the
  // signed-in account. `language` below is still the PACK's
  // language ("en" | "es"); the two are different settings,
  // and the language card on this page says so plainly.
  const { t, language: appLanguage } = useAppLanguage();
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
    // Nov 21, 2026, v63 round 3: the import status wording
    // is translated here. data.title is the video's own title
    // from the API and stays as-is; data.error (server text)
    // stays as-is too. The "captions" / "transcribed audio"
    // choice is this component's own wording, so it is wired.
    setYtStatus(t("input.ytImporting"));
    try {
      const res = await fetch("/api/youtube-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: ytUrl, language }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || t("input.ytFailed"));
      setText(data.text);
      setYtStatus(tf(appLanguage, "input.ytImported", { chars: Number(data.chars || 0).toLocaleString(), title: data.title || t("input.ytThisVideo"), source: data.source === "captions" ? t("input.ytCaptions") : t("input.ytTranscribed") }));
    } catch (err) {
      setYtStatus(err.message || t("input.ytFailed"));
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
    // The example passage follows the PACK's language, like
    // the sermon box placeholder below, not the app language.
    if (!passage) { setStatus(tf(appLanguage, "input.needPassage", { example: language === "es" ? "Romanos 8" : "Romans 8" })); return; }
    setStatus(t("input.startingBuild"));
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passage, refs: confirmed.plan, topics: topic ? [topic] : [], sermonText: text, language, translation }),
    });
    const data = await res.json();
    if (!data.ok && data.error) { setStatus(data.error); return; }
    setGenJob(data.job);
    try { localStorage.setItem("flockpath-active-job", data.job.id); } catch {}
    setStatus(t("input.buildingSeePanel"));
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
    if (manual) { setChecking(true); setStatus(t("input.checkingBuild")); }
    try {
      const res = await fetch(`/api/generate?id=${genJob.id}`);
      const data = await res.json();
      if (!data.ok) { setStatus(data.error || t("input.buildNotFound")); return; }
      setGenJob(data.job);
      const j = data.job;
      if (manual) setLastChecked(new Date());
      if (j.status !== "failed") setFailedSetup(false);
      if (j.status === "done") setStatus(tf(appLanguage, "input.finishedInLibrary", { name: jobName(j) }));
      else if (j.status === "ready_for_review") setStatus(t(isMember ? "input.readyReviewMember" : "input.readyReviewPastor"));
      else if (j.status === "failed") {
        const r = plainFailureReason(j.error, appLanguage);
        setFailedSetup(r.setup);
        setStatus(r.text);
      }
      else if (manual) setStatus(t("input.stillBuildingPanel"));
    } finally {
      if (manual) setChecking(false);
    }
  }

  async function onContinueJob() {
    if (!genJob?.id) return;
    setStatus(t("input.continuingBuild"));
    const res = await fetch("/api/generate/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: genJob.id }),
    });
    const data = await res.json();
    if (!data.ok) { setStatus(data.error || t("input.couldNotContinue")); return; }
    setGenJob(data.job);
    try { localStorage.setItem("flockpath-active-job", data.job.id); } catch {}
    setStatus(t("input.continuedBuild"));
  }

  async function onTopicSearch(e, topicOverride) {
    if (e) e.preventDefault();
    const q = (topicOverride ?? topic).trim();
    if (topicOverride) setTopic(topicOverride);
    if (!q) { setStatus(t("input.needTopic")); return; }
    setStatus(t("input.searchingTopic"));
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
    if (!topicPicked.length) { setTopicMessage(t("input.pickPassageFirst")); return; }
    const lower = text.toLowerCase();
    const fresh = topicPicked.filter((r) => !refForms(r).some((f) => lower.includes(f.toLowerCase())));
    if (!fresh.length) {
      setTopicPicked([]);
      setTopicMessage(t("input.alreadyInList"));
      return;
    }
    setText((t) => (t ? `${t}\n` : "") + fresh.join(", "));
    setTopicPicked([]);
    setTopicMessage(tf(appLanguage, "input.addedToList", { refs: fresh.join(", ") }));
  }

  async function onExtract(e) {
    e.preventDefault();
    setStatus(t("input.extracting"));
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
      setStatus(tf(appLanguage, "input.readingFile", { file: file.name }));
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) { setStatus(data.error || t("input.couldNotReadPdf")); return; }
      setText(data.text);
      setStatus(tf(appLanguage, data.pages === 1 ? "input.loadedPdfOne" : "input.loadedPdfMany", { file: file.name, pages: data.pages, chars: data.chars }));
      return;
    }
    if (!/\.txt$|\.md$/i.test(file.name)) {
      setStatus(t("input.onlyTextFiles"));
      return;
    }
    setText(await file.text());
    setStatus(tf(appLanguage, "input.loadedFile", { file: file.name }));
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
      ? t("input.confirmedReady")
      : tf(appLanguage, "input.confirmedUnder", { n: dayCount }));
    if (plan.length === dayCount) setStep(3);
  }

  // The pastor-facing name for a job: the passage name they
  // chose, never the job number. The number stays in code
  // and logs only (Mac test items 13, 14).
  function jobName(j) {
    return j?.plan?.passage || genPassage || topic || "this pack";
  }

  function jobStatusWords(j, lang) {
    if (!j) return "";
    if (j.status === "queued") return dictT(lang, "input.jobWaiting");
    if (j.status === "running") return dictT(lang, "input.jobBuilding");
    if (j.status === "ready_for_review") return dictT(lang, "input.jobReady");
    if (j.status === "done") return dictT(lang, "input.jobFinished");
    if (j.status === "failed") return dictT(lang, "input.jobStopped");
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
  function timeLeft(j, lang) {
    if (!j?.progress || j.status !== "running" || !j.createdAt) return "";
    const done = j.progress.step - 1;
    if (done < 1) return "";
    const elapsed = Date.now() - new Date(j.createdAt).getTime();
    if (!(elapsed > 0)) return "";
    const left = (elapsed / done) * (j.progress.total - j.progress.step + 1);
    const mins = Math.max(1, Math.round(left / 60000));
    return tf(lang, mins === 1 ? "input.timeLeftOne" : "input.timeLeftMany", { n: mins });
  }

  const jobActive = genJob && ["queued", "running"].includes(genJob.status);
  const jobDone = genJob && ["ready_for_review", "done", "failed"].includes(genJob.status);
  // Nov 11, 2026, v52: a member's journey ends at saving
  // and printing, never at sharing, so a finished member
  // build sits at the save stage, not the share stage.
  const journeyStage = !genJob ? "start" : (genJob.status === "queued" || genJob.status === "running" || genJob.status === "failed") ? "building" : genJob.status === "ready_for_review" ? "review" : isMember ? "save" : "share";

  return (
    <main className="fp-main">
      <JourneyStrip stage={journeyStage} member={isMember} labels={{ start: t("journey.start"), building: t("journey.building"), review: t("journey.review"), approve: t("journey.approve"), share: t("journey.share"), save: t("journey.save"), print: t("journey.print") }} />
      <h1>{t("input.title")}</h1>
      {isMember ? (
        <p>{t("input.introStudies")}</p>
      ) : (
        <p>{t("input.introPacks")}</p>
      )}

      {step === 1 && (
        <section>
          <h2>{t("input.step1")}</h2>
          <section className="fp-card">
            <h3 style={{ marginTop: 0 }}>{t("input.howItWorks")}</h3>
            <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              <li>{t("input.howStep1")}</li>
              <li>{t("input.howStep2")}</li>
              <li>{t("input.howStep3")}</li>
            </ol>
            <p style={{ marginBottom: 0 }}>{t("input.howTime")}</p>
          </section>
          <div className="fp-card">
            <h3 style={{ marginTop: 0 }}>{t("input.languageHeading")}</h3>
            <p>{t("input.packLanguageClarify")}</p>
            <p>
              <label><input type="radio" name="pack-language" checked={language === "en"} onChange={() => { setLanguage("en"); setTranslation("bsb"); }} /> {t("input.packEnglish")}</label>{" "}
              <label><input type="radio" name="pack-language" checked={language === "es"} onChange={() => { setLanguage("es"); setTranslation("rv1909"); }} /> {t("input.packSpanish")}</label>
            </p>
            {language === "es" ? (
              <>
                <p>
                  <label><input type="radio" name="pack-translation" checked={translation === "rv1909"} onChange={() => setTranslation("rv1909")} /> Reina-Valera 1909 {t("input.publicDomainTag")}</label>{" "}
                  <label><input type="radio" name="pack-translation" checked={translation === "spabes"} onChange={() => setTranslation("spabes")} /> La Biblia en Español Sencillo 2026 {t("input.publicDomainTag")}</label>
                </p>
                <p>{t("input.spanishNote")}</p>
                <p>{t("input.narrationNote")}</p>
              </>
            ) : (
              <p>{t("input.englishNote")}</p>
            )}
          </div>
          {isMember ? (
            <p>{t("input.pasteParaMember")}</p>
          ) : (
            <p>{t("input.pastePara")}</p>
          )}
          <form onSubmit={onExtract}>
            <p style={{ marginBottom: 4 }}><strong>{t("input.suggestedTopics")}</strong> - {t("input.suggestedTopicsSuffix")}</p>
            <div className="fp-chip-row">
              {["Forgiveness", "Grace", "Psalm 23", "The Power of the Cross", "Love", "Shepherd"].map((t) => (
                <button key={t} type="button" className="fp-chip" aria-pressed={topic === t} onClick={() => { setTopic(t); onTopicSearch(null, t); }}>{t}</button>
              ))}
            </div>
            <label>{t("input.topicLabel")}<br />
              <input value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder={t("input.topicPh")} />
            </label>
            <p><button type="button" onClick={(e) => onTopicSearch(e)}>{t("input.searchTopic")}</button></p>
            <p><label>{t("input.sermonLabel")}<br />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={{ width: "100%", padding: 8 }} placeholder={language === "es" ? "Juan 3:16, Salmos 23:1-3, o pega tu sermón completo aquí" : "John 3:16, Psalm 23:1-3, or paste your whole sermon here"} />
            </label></p>
            <p><label>{t("input.uploadLabel")} <input type="file" accept=".txt,.md,.pdf" onChange={onFile} /></label></p>
            <p>{t("input.pdfNote")}</p>
            <p><label>{t("input.youtubeLabel")}<br />
              <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="https://www.youtube.com/watch?v=..." />
            </label></p>
            <p><button type="button" onClick={onYoutubeImport} disabled={ytBusy || !ytUrl.trim()}>{ytBusy ? t("input.youtubeImporting") : t("input.youtubeImport")}</button></p>
            <p>{t("input.youtubeNote")}</p>
            {ytStatus && <p><strong>{ytStatus}</strong></p>}
            <button type="submit" className="fp-btn-mobile-block">{t("input.extractRefs")}</button>
          </form>
          {topicResult && (
            <section className="fp-card" style={{ marginTop: 16 }}>
              <h3>{tf(appLanguage, "input.topicResultsHeading", { topic: topicResult.topic })}</h3>
              <p>{t("input.topicResultsIntro")}</p>
              <p>{t("input.topicResultsNote")}</p>
              <h4>{t("input.topicalPassages")}</h4>
              {topicResult.topical.length ? (
                <ul>{topicResult.topical.map((r) => (
                  <li key={r.reference}><label><input type="checkbox" checked={topicPicked.includes(r.reference)} onChange={() => toggleTopic(r.reference)} /> {formatRef(r.reference)} ({r.count === 1 ? tf(appLanguage, "input.inDictOne", { n: r.count }) : tf(appLanguage, "input.inDictMany", { n: r.count })})</label></li>
                ))}</ul>
              ) : <p>{t("input.noDictEntry")}</p>}
              <h4>{t("input.devotionalAnchors")}</h4>
              {topicResult.devotionalAnchors.length ? (
                <ul>{topicResult.devotionalAnchors.map((r) => (
                  <li key={r.reference}><label><input type="checkbox" checked={topicPicked.includes(r.reference)} onChange={() => toggleTopic(r.reference)} /> {formatRef(r.reference)} ({tf(appLanguage, r.count === 1 ? "input.devotionalCountOne" : "input.devotionalCountMany", { n: r.count, example: r.example })})</label></li>
                ))}</ul>
              ) : <p>{t("input.noDevotionalAnchor")}</p>}
              <button type="button" onClick={useTopicRefs}>{t("input.usePicked")}</button>
              {topicMessage && <p><strong>{topicMessage}</strong></p>}
            </section>
          )}
        </section>
      )}

      {step === 2 && result && (
        <section>
          <h2>{t("input.step2")}</h2>
          <p>{t("input.uncheckIntro")}</p>
          <ul>
            {result.refs.map((r, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" disabled={r.kind !== "verse" && r.kind !== "range"} checked={(r.kind === "verse" || r.kind === "range") ? kept.includes(r.reference) : false} onChange={() => toggle(r.reference)} />
                  {" "}{formatRef(r.reference, language)} ({r.kind === "range" ? t("input.kindPassage") : r.kind}){r.note ? ` - ${r.note}` : ""}
                </label>
              </li>
            ))}
          </ul>
          <h3>{t("input.howLong")}</h3>
          <p>
            {[3, 5, 7].map((n) => (
              <label key={n} style={{ marginRight: 16 }}>
                <input type="radio" name="dayCount" checked={dayCount === n} onChange={() => setDayCount(n)} /> {n === 3 ? t("input.dayCount3") : n === 5 ? t("input.dayCount5") : t("input.dayCount7")}
              </label>
            ))}
          </p>
          <h3>{tf(appLanguage, "input.proposedPlan", { n: dayCount })}</h3>
          <ol>{kept.slice(0, dayCount).map((r) => <li key={r}>{formatRef(r, language)}</li>)}</ol>
          {kept.length > dayCount && <p>{tf(appLanguage, "input.onlyFirst", { n: dayCount })}</p>}
          {kept.length < dayCount && <p>{tf(appLanguage, "input.addVerses", { n: dayCount })}</p>}
          <p><button onClick={onConfirm}>{t("input.confirm")}</button> <button type="button" onClick={() => setStep(1)}>{t("input.backStep1")}</button></p>
        </section>
      )}
      {step === 2 && !result && (
        <section>
          <h2>{t("input.step2")}</h2>
          <p>{t("input.noVersesYet")}</p>
          <p><button type="button" onClick={() => setStep(1)}>{t("input.backStep1")}</button></p>
        </section>
      )}

      {step === 3 && confirmed && (
        <section>
          <h2>{t("input.step3")}</h2>
          <p>{tf(appLanguage, "input.topicLine", { topic: topic || t("input.topicNone") })}</p>
          <ol>{confirmed.plan.map((r) => <li key={r}>{formatRef(r, language)}</li>)}</ol>
          <p>{confirmed.complete ? t("input.readyToBuild") : tf(appLanguage, "input.underVerses", { n: dayCount })}</p>
          {confirmed.complete && (
            <div className="fp-card" style={{ marginTop: 16 }}>
              <h3>{t("input.buildPack")}</h3>
              <label>{t("input.packNameLabel")}<br />
                <input value={genPassage} onChange={(e) => setGenPassage(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder={t("input.packNamePh")} />
              </label>
              <p><button type="button" className="fp-btn-mobile-block" onClick={onGenerate} disabled={jobActive}>{t("input.startBuilding")}</button></p>
              {jobActive && <p>{t("input.buildAlreadyRunning")}</p>}
              <p>{tf(appLanguage, "input.whatHappens", { ending: t(isMember ? "input.whatHappensMember" : "input.whatHappensPastor") })}</p>
              {jobDone && (
                <p>
                  {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>{isMember ? t("input.reviewStudy") : t("input.reviewDraft")}</a>}
                  {genJob.packId && <> <a href={`/pack/${genJob.packId}`}>{t("input.openFinishedPack")}</a> | <a href={`/api/packs/pdf-file?id=${encodeURIComponent(genJob.packId)}`}>{t("packs.downloadPdf")}</a></>}
                  {!genJob.packId && genJob.pdf && <> <a href={genJob.pdf}>{t("packs.downloadPdf")}</a></>}
                </p>
              )}
              <p>{t("input.ifStopsContinue")}</p>
            </div>
          )}
          <p><button type="button" onClick={() => setStep(2)}>{t("input.backStep2")}</button></p>
        </section>
      )}
      {step === 3 && !confirmed && (
        <section>
          <h2>{t("input.step3")}</h2>
          <p>{t("input.noPlanYet")}</p>
          <p><button type="button" onClick={() => setStep(2)}>{t("input.backStep2")}</button></p>
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
        <section className="fp-build-panel" aria-label={t("input.buildPanelAria")}>
          <h2 style={{ marginTop: 0, fontSize: 24 }}>
            {genJob.status === "running" || genJob.status === "queued" ? t("input.buildingNow") : genJob.status === "ready_for_review" ? t("input.readyReview") : genJob.status === "done" ? t("input.finished") : t("input.stopped")}
          </h2>
          <div className="fp-build-top">
            {genJob.progress && <BuildRing progress={genJob.progress} status={genJob.status} lang={appLanguage} />}
            <div style={{ flex: "1 1 300px" }}>
              <p style={{ fontSize: 18, marginTop: 0 }}><strong>&ldquo;{jobName(genJob)}&rdquo;</strong> - {jobStatusWords(genJob, appLanguage)}.</p>
              {genJob.progress && (genJob.status === "queued" || genJob.status === "running") && (
                <p style={{ fontSize: 17 }}>{tf(appLanguage, "input.stepLine", { step: genJob.progress.step, total: genJob.progress.total, label: genJob.progress.label })}</p>
              )}
              {timeLeft(genJob, appLanguage) && <p style={{ fontSize: 16 }}>{timeLeft(genJob, appLanguage)}</p>}
            </div>
          </div>
          {genJob.progress && <BuildChecklist progress={genJob.progress} refs={genJob.plan?.refs} status={genJob.status} lang={appLanguage} />}
          <p>
            <button type="button" className="fp-btn-mobile-block" onClick={() => onCheckJob(true)} disabled={checking} style={{ marginRight: 8 }}>{checking ? t("input.checking") : t("input.checkStatus")}</button>
            {(genJob.status === "running" || (genJob.status === "failed" && !failedSetup)) && <button type="button" className="fp-btn-gold fp-btn-mobile-block" onClick={onContinueJob} style={{ marginRight: 8 }}>{t("input.continue")}</button>}
            {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>{isMember ? t("input.reviewStudy") : t("input.reviewDraft")}</a>}
            {genJob.packId && <> <a href={`/pack/${genJob.packId}`}>{t("input.openFinishedPack")}</a> | <a href={`/api/packs/pdf-file?id=${encodeURIComponent(genJob.packId)}`}>{t("packs.downloadPdf")}</a></>}
            {!genJob.packId && genJob.pdf && <> <a href={genJob.pdf}>{t("packs.downloadPdf")}</a></>}
          </p>
          {lastChecked && <p>{tf(appLanguage, "input.lastChecked", { time: lastChecked.toLocaleTimeString() })}</p>}
          <p>{t("input.leaveAndReturn")}</p>
          {genJob.status === "failed" && failedSetup ? (
            <p>{t("input.failedSetupNote")}</p>
          ) : (
            <p>{t("input.ifStopsShort")}</p>
          )}
        </section>
      )}
    </main>
  );
}
