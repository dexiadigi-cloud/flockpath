"use client";
import { useState, useEffect } from "react";

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

export default function InputPage() {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState(null);
  const [kept, setKept] = useState([]);
  const [status, setStatus] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  const [topicResult, setTopicResult] = useState(null);
  const [topicPicked, setTopicPicked] = useState([]);
  const [topicMessage, setTopicMessage] = useState("");
  const [genJob, setGenJob] = useState(null);
  const [genPassage, setGenPassage] = useState("");
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [failedSetup, setFailedSetup] = useState(false);

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
      body: JSON.stringify({ passage, refs: confirmed.plan, topics: topic ? [topic] : [], sermonText: text }),
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
      else if (j.status === "ready_for_review") setStatus("Ready for your review. It is a draft, not a locked pack, until you approve it.");
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

  async function onTopicSearch(e) {
    e.preventDefault();
    setStatus("Searching Phos for this topic...");
    setTopicResult(null);
    setTopicPicked([]);
    setTopicMessage("");
    const res = await fetch("/api/topic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
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
      body: JSON.stringify({ text }),
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
    const plan = kept.slice(0, 5);
    setConfirmed({
      refs: kept,
      plan,
      complete: plan.length === 5,
    });
    setStatus(plan.length === 5
      ? "Confirmed. This plan is ready for the last step."
      : "Confirmed, but under 5 verses. Add verses before building, the tool will not pad the plan.");
    if (plan.length === 5) setStep(3);
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
  const journeyStage = !genJob ? "start" : (genJob.status === "queued" || genJob.status === "running" || genJob.status === "failed") ? "building" : genJob.status === "ready_for_review" ? "review" : "share";

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <JourneyStrip stage={journeyStage} />
      <h1>Start a pack</h1>
      <p>Three steps, one at a time: what the pack is about, which verses it uses, then its name and build.</p>

      {step === 1 && (
        <section>
          <h2>Step 1 of 3: What is this pack about?</h2>
          <p>Paste your sermon, a verse list, or a passage. The tool finds the verse references in what you pasted, shows them back, and you correct them before anything is built. A topic alone never builds a pack: search a topic, pick passages from Phos, then extract and confirm them. If you paste your whole sermon, the cover will carry a short summary and one quote from it. If you start from a topic instead, you can still add your own short note for the cover on the review page.</p>
          <form onSubmit={onExtract}>
            <label>Topic (optional, search Phos for suggested passages)<br />
              <input value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="e.g. shepherd, grace" />
            </label>
            <p><button type="button" onClick={onTopicSearch}>Search topic in Phos</button></p>
            <p><label>Sermon paste or verse list<br />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={{ width: "100%", padding: 8 }} placeholder="John 3:16, Psalm 23:1-3, or paste your whole sermon here" />
            </label></p>
            <p><label>Or upload a .txt, .md, or .pdf file: <input type="file" accept=".txt,.md,.pdf" onChange={onFile} /></label></p>
            <p>PDFs are read for their text only, then the file is deleted. A scanned-image PDF has no text to read, so paste its text instead if that happens.</p>
            <button type="submit">Extract refs</button>
          </form>
          {topicResult && (
            <section style={{ border: "1px solid #ddd", padding: 16, marginTop: 16 }}>
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
                  {" "}{formatRef(r.reference)} ({r.kind === "range" ? "passage" : r.kind}){r.note ? ` - ${r.note}` : ""}
                </label>
              </li>
            ))}
          </ul>
          <h3>Proposed 5-day plan, from checked passages</h3>
          <ol>{kept.slice(0, 5).map((r) => <li key={r}>{formatRef(r)}</li>)}</ol>
          {kept.length > 5 && <p>Only the first 5 checked passages are used in the plan.</p>}
          {kept.length < 5 && <p>Add verses to reach 5. The tool will not invent the missing days.</p>}
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
          <ol>{confirmed.plan.map((r) => <li key={r}>{formatRef(r)}</li>)}</ol>
          <p>{confirmed.complete ? "Ready to build. When it runs, building a pack takes about 6 to 9 minutes with OpenRouter, Grok, or Google, or up to 30 minutes with the local model on an older computer, because the model writes each day separately and every verse is checked before locking." : "Under 5 verses. Building waits until the plan is complete."}</p>
          {confirmed.complete && (
            <div style={{ border: "1px solid #ddd", padding: 16, marginTop: 16 }}>
              <h3>Build this pack</h3>
              <label>Name for the pack<br />
                <input value={genPassage} onChange={(e) => setGenPassage(e.target.value)} style={{ width: "100%", padding: 8 }} placeholder="e.g. Romans 8" />
              </label>
              <p><button type="button" onClick={onGenerate} disabled={jobActive}>Start building this pack</button></p>
              {jobActive && <p>A build is already running. See the status panel below.</p>}
              <p>What happens when you tap this button: Flockpath starts building your pack. It writes one day at a time and checks every verse, so most packs take about 6 to 9 minutes with OpenRouter, Grok, or Google, and up to 30 minutes with the local model on an older computer. With OpenRouter, Grok, or Google the writing happens through that provider&apos;s service; with Local it happens here on your computer. You can leave this page and come back; when the draft is ready it waits for your review, and nothing locks until you approve it.</p>
              {jobDone && (
                <p>
                  {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>Review and approve this draft</a>}
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
        <section style={{ border: "2px solid #c9a227", borderRadius: 10, padding: 20, marginBottom: 24, background: "#fff8e1" }}>
          <h2 style={{ marginTop: 0, fontSize: 24 }}>
            {genJob.status === "running" || genJob.status === "queued" ? "Your pack is being built!" : genJob.status === "ready_for_review" ? "Your pack is ready for review!" : genJob.status === "done" ? "Your pack is finished!" : "Building stopped."}
          </h2>
          <p style={{ fontSize: 18 }}><strong>&ldquo;{jobName(genJob)}&rdquo;</strong> - {jobStatusWords(genJob)}.</p>
          {genJob.progress && (genJob.status === "queued" || genJob.status === "running") && (
            <div>
              <p style={{ fontSize: 17 }}>Step {genJob.progress.step} of {genJob.progress.total}: {genJob.progress.label}.</p>
              <progress value={genJob.progress.step} max={genJob.progress.total} style={{ width: "100%", height: 20 }} />
              {timeLeft(genJob) && <p style={{ fontSize: 16 }}>{timeLeft(genJob)}</p>}
            </div>
          )}
          <p>
            <button type="button" onClick={() => onCheckJob(true)} disabled={checking} style={{ marginRight: 8 }}>{checking ? "Checking..." : "Check build status"}</button>
            {(genJob.status === "running" || (genJob.status === "failed" && !failedSetup)) && <button type="button" onClick={onContinueJob} style={{ marginRight: 8 }}>Continue from last finished section</button>}
            {genJob.draftId && <a href={`/review?draft=${genJob.draftId}`}>Review and approve this draft</a>}
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
