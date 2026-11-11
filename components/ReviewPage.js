"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JourneyStrip from "./JourneyStrip";
import { leaderQuestionsForDays, lockPack, packSlug, verifyPack } from "../lib/pack.mjs";
import { checkQuality } from "../lib/quality.mjs";
import { COLORING_TEMPLATES, matchColoring } from "../lib/coloring.mjs";
import { formatRef, formatRefsInText, parseRef } from "../lib/refs.mjs";
import verseStore from "../data/bsb-GEN.json";

// Nov 4, 2026, pastor-facing checks (Mac pastor-role test
// items 6, 19, 22, 23, 24): the old gates section printed
// raw gate strings, full quoted verse dumps, and every word
// count, which no pastor wants to read. The gates themselves
// are unchanged; only what the pastor sees changed. Blocking
// problems are reworded in plain language and flagged on the
// section itself, below. Pure length checks (word counts,
// overlap numbers) no longer show on the page at all: they go
// to the review log (see the /api/review-log post below),
// where they belong, behind the scenes.
function fullRef(code) {
  try { return formatRef(code); } catch { return code; }
}

// Nov 5, 2026, round-3: a pastor reads full book names in
// review, never codes. Stored refs stay codes (the verse
// store, verification, and the Read directive all key on
// them), so convert the pastor-visible text when a draft
// enters state: the code-appended "(Read JAS 1:4.)" in
// leader notes, a kid title that fell back to the verse
// reference, and any code that slipped into model prose.
// The PDF already converts at render time; this is the
// same rule for the review screen. Applied once at load,
// so Reset restores this same form.
function displayNames(p) {
  (p.adultDevotionals ?? []).forEach((a) => {
    a.title = formatRefsInText(a.title ?? "");
    a.body = formatRefsInText(a.body ?? "");
    a.prayer = formatRefsInText(a.prayer ?? "");
  });
  (p.kidDevotionals ?? []).forEach((k) => {
    k.title = formatRefsInText(k.title ?? "");
    k.retelling = formatRefsInText(k.retelling ?? "");
    k.activity = formatRefsInText(k.activity ?? "");
  });
  (p.leaderQuestions ?? []).forEach((q) => {
    q.question = formatRefsInText(q.question ?? "");
    q.leaderNote = formatRefsInText(q.leaderNote ?? "");
  });
  return p;
}

function plainScriptureError(e) {
  const m = String(e).match(/for (\S+ \d+:\d+)/);
  const ref = m ? fullRef(m[1]) : "";
  if (/Translation label mismatch/.test(e)) return `${ref} is labeled with the wrong translation.`;
  if (/Unknown reference/.test(e)) return `${ref} cannot be verified.`;
  if (/Verse mismatch/.test(e)) return `${ref} does not match the verse store.`;
  // Nov 5, 2026, round-3 cover note: the sermon quote is
  // not Scripture, so its lock error needs its own plain
  // words, not the verse mapping above.
  if (/Sermon quote does not match/.test(e)) return "The sermon quote does not match the sermon you pasted. Fix it, or clear it, then try again.";
  if (/Sermon quote cannot be verified/.test(e)) return "The sermon quote cannot be checked, because this pack has no sermon text. Clear the quote, then try again.";
  return String(e).split("quoted:")[0].trim();
}

function plainIssue(issue) {
  let s = String(issue);
  s = s.replace(/Adult (\w+) and (\w+) bodies overlap too much \(similarity [0-9.]+\)\. Rewrite one with a different angle\./, "$1's and $2's adult sections cover the same ground too closely. Rewrite one with a different angle.");
  s = s.replace(/Kid (\w+) and (\w+) retellings overlap too much \(similarity [0-9.]+\)\./, "$1's and $2's kid retellings cover the same ground too closely.");
  s = s.replace(/\(similarity [0-9.]+\)/g, "");
  s = s.replace(/\bAdult (\w+)\b/g, "$1's adult section");
  s = s.replace(/\bKid (\w+)\b/g, "$1's kid section");
  return s;
}

function plainWarning(w) {
  let s = String(w);
  // Nov 5, 2026, round-2 retelling warning, widened v25
  // to the whole retelling: a retelling that quotes the
  // verse anywhere in it is flagged in pastor speak,
  // before the generic day-name rewrite below would
  // flatten it into a bare restatement.
  s = s.replace(/Kid (\w+): retelling quotes the verse itself\./, "$1's kid section quotes the verse. A retelling should say it in fresh words for kids.");
  s = s.replace(/Leader Q(\d+):/g, "Leader question $1:");
  s = s.replace(/\bAdult (\w+):/g, "$1's adult section:");
  s = s.replace(/\bKid (\w+):/g, "$1's kid section:");
  return s;
}

// Length checks are numbers, not judgement: a pastor does
// not need to know a note is 33 words instead of 40. Those
// stay in the log only, never on this page.
function isLengthCheck(w) {
  return /words, outside/.test(w) || /verse overlap/.test(w);
}

function mentionsDay(text, day) {
  return new RegExp(`\\b${day}\\b`, "i").test(String(text));
}

// Step 5: pastor review page.
//
// What the pastor sees, in order:
//  1. Two gates, in plain words, computed live as they edit:
//     Scripture exactness (verifyPack) and originality (checkQuality).
//  2. The pack itself, editable, EXCEPT Scripture text.
//     Scripture text is never typed. Changing a reference refills
//     the text from the verse store, so a typo cannot become a
//     misquote. The memory verse text is read-only for the same reason.
//  3. Approve and Lock, enabled only when both gates pass.
//     Locking snapshots the pack and shows its hash. After locking,
//     fields become read-only. Unlocking creates a new draft, it
//     does not silently edit a locked pack.
//
// Auth, generation, PDF, and share link are later steps. This page
// proves the review-and-lock loop with the real Step 4 pack.

const ALLOWED_REFS = ["GEN 1:1", "GEN 1:3", "GEN 1:27", "GEN 1:31", "GEN 2:3"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function fillVerse(ref, storeMap) {
  return { reference: ref, translation: "bsb", text: storeMap[ref] ?? "" };
}

function Field({ label, value, onChange, multiline, readOnly, maxLength }) {
  const style = { width: "100%", padding: 8, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, background: readOnly ? "#eee" : "#fff" };
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {multiline ? (
        <textarea rows={4} style={style} value={value} readOnly={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input style={style} value={value} readOnly={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function ReviewPage({ session, draftId }) {
  // Nov 3, 2026, agent-test fix W1: when a draft id is given,
  // the page used to render the Genesis demo draft first and
  // swap in the real draft only after the fetch resolved, so
  // a pastor editing in that window edited the wrong pack,
  // and a failed fetch still left the editable demo on
  // screen. Now a draft page starts with no pack at all and
  // renders a loading state (or an error-only view) until the
  // fetch resolves.
  // Nov 4, 2026, new-account landing (Mac test item 5):
  // with no draft id, the page no longer loads the Genesis
  // demo draft either. A pastor who just signed in sees
  // nothing to review, and a plain pointer to Start a pack,
  // instead of a demo pack that looks like their own work.
  // The Genesis demo pack is still viewable any time at
  // /pack/generated-genesis-1, linked from the sign-in page.
  const [pack, setPack] = useState(null);
  // Nov 3, 2026, agent-test fix W2: Reset used to restore the
  // Genesis demo even for a worker draft, dropping the session
  // prefill. The loaded draft is kept here so Reset restores
  // it, not the demo.
  const [initialPack, setInitialPack] = useState(null);
  // Nov 1, 2026, review-before-lock: when a draft id is given,
  // the page loads that worker draft instead of the Genesis
  // demo draft, with its own merged verse store. Scripture
  // text still refills from the store, never from typed text.
  // Allowed references are that draft's own verses, so a day's
  // verse can only be swapped among the confirmed plan's verses.
  const [store, setStore] = useState(verseStore);
  const [allowedRefs, setAllowedRefs] = useState(ALLOWED_REFS);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [draftError, setDraftError] = useState("");
  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/drafts?id=${draftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) { setDraftError(data.error || "Draft not found."); setDraftLoading(false); return; }
        const p = displayNames(JSON.parse(JSON.stringify(data.draft)));
        if (session?.name) p.pastorName = session.name;
        if (session?.church) p.church = session.church;
        setNoteRef(p.pastorNote?.verse?.reference ? fullRef(p.pastorNote.verse.reference) : "");
        setNoteVerseStatus(p.pastorNote?.verse?.text ? "found" : "");
        setPack(p);
        setInitialPack(JSON.parse(JSON.stringify(p)));
        setStore(data.verseStore);
        const refs = [p.memoryVerse.reference, ...p.adultDevotionals.map((d) => d.scripture.reference)];
        setAllowedRefs([...new Set(refs)]);
        setDraftLoading(false);
      })
      .catch(() => { setDraftError("Could not load this draft."); setDraftLoading(false); });
  }, [draftId]);
  const [locked, setLocked] = useState(null);
  const [saved, setSaved] = useState("");
  const [lockError, setLockError] = useState("");
  const [pdfLink, setPdfLink] = useState("");

  // Nov 1, 2026, section toggles: unchecked means omitted
  // from the final pack, not broken. A day is adult plus kid
  // together. Memory verse cannot be unchecked. At least one
  // day must stay, otherwise there is no pack to lock.
  const [toggles, setToggles] = useState({ days: {}, leader: true, song: true, classic: true, coloring: true, coverNote: true });
  // Nov 5, 2026, round-5: a pastor can accept a warning
  // ("This is fine") instead of editing or unchecking.
  // Accepted warnings are plain-text keys, so an edit that
  // changes the warning brings the flag back for a fresh
  // look. Session-only, like the toggles: Reset clears them,
  // and they never enter the locked pack.
  const [acceptedWarnings, setAcceptedWarnings] = useState([]);
  const acceptedSet = new Set(acceptedWarnings);
  const acceptWarning = (w) => { if (!acceptedSet.has(w)) setAcceptedWarnings((a) => [...a, w]); };
  const unacceptWarning = (w) => setAcceptedWarnings((a) => a.filter((x) => x !== w));
  // Nov 5, 2026, v32: Rewrite a section that quotes its verse
  // verbatim. Jeremiah's request: when the review page flags
  // an adult body for quoting its verse, the pastor should be
  // able to click Rewrite and have the model rewrite just the
  // offending paragraph(s) in its own words, instead of
  // deleting a whole paragraph by hand (a large edit that
  // defeats the purpose of the app). The verse is never in the
  // model prompt, so it cannot be quoted again from the
  // prompt, and the worker verifies the result against the
  // verse before returning it. State is keyed by day: status
  // plus the rewrite id, so clicking again while one is
  // running resumes polling the same request instead of
  // queuing a duplicate. The quality check re-runs when the
  // pack changes, so a fixed section clears its own flag.
  const [rewriteState, setRewriteState] = useState({});
  const rewriteDayBody = async (day) => {
    const a = (pack?.adultDevotionals ?? []).find((d) => d.day === day);
    if (!a) return;
    try {
      let id = rewriteState[day]?.id;
      if (!id) {
        const res = await fetch("/api/rewrite", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, day, body: a.body, verseRef: a.scripture.reference, verseText: a.scripture.text }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Could not start the rewrite.");
        id = data.id;
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "running", id, message: "Rewriting this section in fresh words. This takes about 2-3 minutes." } }));
      let result = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const poll = await fetch(`/api/rewrite?id=${id}`).then((r) => r.json()).catch(() => ({}));
        if (poll.status === "done" && poll.result) { result = poll.result; break; }
        if (poll.status === "failed") throw new Error("The rewrite failed. Try again, or edit the section by hand.");
      }
      if (!result) throw new Error("The rewrite is still running. Click Rewrite again in a minute to check on it.");
      if (result.body && result.body !== a.body) {
        set((p) => { const d = p.adultDevotionals.find((x) => x.day === day); if (d) d.body = result.body; });
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "done", id, message: result.note || "Rewritten. Check the new wording below." } }));
    } catch (e) {
      setRewriteState((s) => ({ ...s, [day]: { status: "error", id: rewriteState[day]?.id, message: String(e.message || e) } }));
    }
  };
  // Nov 5, 2026, round-3 cover note: the verse the pastor
  // types for his own note lives in component state until
  // it resolves, because the pack only ever carries a
  // verse whose text came from the store.
  const [noteRef, setNoteRef] = useState("");
  const [noteVerseStatus, setNoteVerseStatus] = useState(""); // "" | "checking" | "found" | "not-found" | "unknown-book"
  const dayNames = pack ? pack.adultDevotionals.map((d) => d.day) : [];
  const toggleDay = (day) => {
    setToggles((t) => {
      const days = { ...t.days };
      const currentlyOn = days[day] !== false;
      const onCount = dayNames.filter((d) => (days[d] !== false)).length;
      if (currentlyOn && onCount <= 1) return t;
      days[day] = !currentlyOn;
      return { ...t, days };
    });
  };
  const isDayOn = (day) => toggles.days[day] !== false;
  const filteredPack = useMemo(() => {
    if (!pack) return null;
    const p = JSON.parse(JSON.stringify(pack));
    p.adultDevotionals = p.adultDevotionals.filter((d) => isDayOn(d.day));
    p.kidDevotionals = p.kidDevotionals.filter((d) => isDayOn(d.day));
    // Nov 5, 2026, round-5: leader questions belong to days
    // (one per day, in day order), so an unchecked day's
    // question leaves with it. A 2-day pack no longer prints
    // leader questions about verses that are not in it.
    if (!toggles.leader) p.leaderQuestions = [];
    else p.leaderQuestions = leaderQuestionsForDays(p.leaderQuestions, dayNames, new Set(dayNames.filter(isDayOn)));
    if (!toggles.song) { delete p.hymn; delete p.chorus; }
    if (!toggles.classic) {
      delete p.classicDevotional;
      // Nov 2, 2026, denomination labels: unchecking the classic
      // devotional also removes the devotional voices from the
      // Voices section and the PDF sources list, so the locked
      // pack never lists a voice it does not print.
      if (p.phosVoices) p.phosVoices = { ...p.phosVoices, devotionals: [] };
    }
    if (!toggles.coloring) delete p.coloring;
    // Nov 5, 2026, round-3 cover note: unchecking the cover
    // note omits the whole block from the pack, like the
    // other sections. An empty summary, or a pastor note
    // without a verified verse or any words, also prints
    // nothing, so it is dropped here rather than locking a
    // pack with a half-filled note. The draft in state keeps
    // what the pastor typed, so nothing is lost.
    if (!toggles.coverNote) { delete p.sermonSnapshot; delete p.pastorNote; }
    if (!(p.sermonSnapshot?.summary ?? "").trim()) delete p.sermonSnapshot;
    if (!p.pastorNote?.verse?.text || !(p.pastorNote?.note ?? "").trim()) delete p.pastorNote;
    delete p.hymnCandidates;
    return p;
  }, [pack, toggles]);

  const scripture = useMemo(() => (filteredPack ? verifyPack(filteredPack, store, "bsb") : { ok: false, errors: [] }), [filteredPack, store]);
  const quality = useMemo(() => (filteredPack ? checkQuality(filteredPack) : { ok: false, issues: [], warnings: [] }), [filteredPack]);
  const canLock = Boolean(filteredPack) && scripture.ok && quality.ok && !locked;
  // Pastor-facing check text: blocking problems in plain
  // words; length checks kept out of the page, into the log.
  const plainScripture = scripture.errors.map(plainScriptureError);
  const plainIssues = quality.issues.map(plainIssue);
  const shownWarnings = (quality.warnings ?? []).filter((w) => !isLengthCheck(w)).map(plainWarning);
  const hiddenWarningCount = (quality.warnings ?? []).filter(isLengthCheck).length;
  // Nov 5, 2026, round-5: warnings the pastor accepted
  // ("This is fine") leave the red lists and show muted
  // below with an Undo, so a reviewed warning never nags
  // twice in one session. Blocks can never be accepted.
  const activeWarnings = shownWarnings.filter((w) => !acceptedSet.has(w));
  const acceptedShown = shownWarnings.filter((w) => acceptedSet.has(w));
  const flagsForDay = (day) => ({
    issues: plainIssues.filter((t) => mentionsDay(t, day)),
    warnings: activeWarnings.filter((t) => mentionsDay(t, day)),
  });
  const leaderFlags = {
    issues: plainIssues.filter((t) => /Leader/i.test(t)),
    warnings: activeWarnings.filter((t) => /Leader/i.test(t)),
  };
  // Nov 4, 2026, review logging (Mac test items 19, 30):
  // the full check detail, including the length checks the
  // pastor no longer sees, is posted to the server log
  // whenever the verdict changes. Fire-and-forget: a logging
  // failure never disturbs the review page.
  const lastLogged = useRef("");
  useEffect(() => {
    if (!pack) return;
    const signature = JSON.stringify({
      draftId: draftId || null,
      scriptureOk: scripture.ok, scriptureErrors: scripture.errors,
      qualityOk: quality.ok, issues: quality.issues, warnings: quality.warnings ?? [],
    });
    if (signature === lastLogged.current) return;
    lastLogged.current = signature;
    fetch("/api/review-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draftId || null, scripture, quality }),
    }).catch(() => {});
  }, [pack, draftId, scripture, quality]);

  // Loading and error views for a draft page. These returns
  // sit after every hook above, so hook order never changes.
  if (draftId && draftLoading) {
    return (
      <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
        <JourneyStrip stage="review" />
        <h1>Flockpath: pastor review</h1>
        <p>Loading your draft...</p>
      </main>
    );
  }
  if (draftId && draftError) {
    return (
      <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
        <JourneyStrip stage="review" />
        <h1>Flockpath: pastor review</h1>
        <p><strong>{draftError}</strong></p>
        <p>This draft may belong to another pastor, or it may already have been locked. Nothing is shown for editing until the draft loads.</p>
      </main>
    );
  }
  if (!pack) {
    return (
      <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
        <JourneyStrip stage="review" />
        <h1>Flockpath: pastor review</h1>
        <p>Nothing to review yet.</p>
        <p>Go to <a href="/input">Start a pack</a> to generate a new pack. When a build finishes, its draft opens here for your review.</p>
      </main>
    );
  }

  const set = (fn) => setPack((p) => { const n = JSON.parse(JSON.stringify(p)); fn(n); return n; });

  // Nov 5, 2026, round-3 cover note: resolve the verse the
  // pastor typed for his own note. The typed words are
  // parsed to a code reference, the exact BSB text is
  // fetched from the store, and the verse joins the review
  // store, so the Scripture gate can verify it like any
  // other verse. A verse that cannot be found leaves the
  // note unprintable, and the section says so plainly,
  // rather than locking a misquote.
  const wordCount = (s) => String(s ?? "").split(/\s+/).filter(Boolean).length;
  const normText = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // Nov 5, 2026, v26, Jeremiah's call: a pastor who
  // pastes a quote WITH quotation marks saw the pack
  // refuse to lock, because the check compares the
  // quote against the sermon text and the marks are
  // not in the sermon. Quotation marks are added at
  // print time (the PDF wraps the quote), so they are
  // stripped on input here and in the lock check, and
  // never stored. Only double quotes are stripped;
  // single quotes can be part of the words.
  const stripQuoteMarks = (s) => String(s ?? "").trim().replace(/^["\u201c\u201d]+/, "").replace(/["\u201c\u201d]+$/, "").trim();
  const quoteMatchesSermon = !pack?.sermonSnapshot?.quote || !pack?.sermonText || normText(pack.sermonText).includes(normText(stripQuoteMarks(pack.sermonSnapshot.quote)));

  async function resolveNoteVerse(refInput) {
    const code = parseRef(refInput);
    if (!code) { setNoteVerseStatus("unknown-book"); return; }
    setNoteVerseStatus("checking");
    try {
      const res = await fetch(`/api/verse?ref=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.text) {
        setNoteVerseStatus("not-found");
        set((p) => { if (p.pastorNote) p.pastorNote.verse = { reference: code, translation: "bsb", text: "" }; });
        return;
      }
      setStore((s) => ({ ...s, [code]: data.text }));
      set((p) => { p.pastorNote = { ...(p.pastorNote ?? { note: "" }), verse: { reference: code, translation: "bsb", text: data.text } }; });
      setNoteVerseStatus("found");
    } catch {
      setNoteVerseStatus("not-found");
    }
  }

  async function onLock() {
    setLockError("");
    // Nov 4, 2026, blocked lock feedback (Mac test items
    // 21, 22): the old button was disabled while blocked, so
    // tapping it did nothing and said nothing. Now the
    // button always answers: when a check blocks, tapping it
    // shows the plain reason right here, next to the button.
    if (!canLock) {
      const first = plainScripture[0] || plainIssues[0] || "A check has not passed yet.";
      setLockError(`Not ready to lock yet: ${first} Fix it, or uncheck that section, then try again.`);
      return;
    }
    const result = lockPack(filteredPack, store, "bsb");
    // Nov 3, 2026, agent-test fix W3: a failed lock used to
    // return silently, leaving the pastor with no explanation.
    // A lock can still fail (a required field cleared, for
    // example), so the error now shows next to the button.
    if (!result.ok) { setLockError(result.errors?.join(" ") || "Lock failed. Check the gates above."); return; }
    setLocked(result.pack);
    // Step 7: a locked pack saves itself to this pastor's library.
    try {
      const res = await fetch("/api/packs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: result.pack.id, title: result.pack.title, passage: result.pack.passage, status: "locked", lockHash: result.pack.lockHash, pack: result.pack }),
      });
      setSaved(res.ok ? "Saved to your packs library." : "Locked, but not saved to the library. Try the library page again.");
      // Nov 2, 2026, pastor-test fix: a locked pack must get
      // a print PDF without a manual build step. Build it
      // here, after the library save, from the locked pack
      // itself. A PDF failure does not un-lock the pack;
      // the pastor can retry from the pack page.
      if (res.ok) {
        try {
          const pdfRes = await fetch("/api/packs/pdf", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: result.pack.id }),
          });
          const pdfJson = await pdfRes.json().catch(() => ({}));
          if (pdfJson.ok) setPdfLink(pdfJson.pdf);
          else setSaved("Saved to your packs library. Print PDF build failed, retry from the pack page.");
        } catch {
          setSaved("Saved to your packs library. Print PDF build failed, retry from the pack page.");
        }
      }
      // Review-before-lock: a draft that has just been locked
      // is no longer pending review, so remove it. If the
      // delete fails, the draft stays listed, which is safe:
      // it can be opened again, but it cannot overwrite the
      // locked pack, because locking always creates a new lock.
      if (res.ok && draftId) {
        try { await fetch(`/api/drafts?id=${draftId}`, { method: "DELETE" }); } catch {}
      }
    } catch {
      setSaved("Locked, but not saved to the library.");
    }
  }

  function onUnlock() {
    setLocked(null);
    set((p) => { p.status = "draft"; });
  }

  function onReset() {
    setLocked(null);
    if (initialPack) {
      setPack(JSON.parse(JSON.stringify(initialPack)));
      setNoteRef(initialPack.pastorNote?.verse?.reference ? fullRef(initialPack.pastorNote.verse.reference) : "");
      setNoteVerseStatus(initialPack.pastorNote?.verse?.text ? "found" : "");
    }
    setToggles({ days: {}, leader: true, song: true, classic: true, coloring: true, coverNote: true });
    setAcceptedWarnings([]);
  }

  const ro = Boolean(locked);

  // Nov 5, 2026, round-2 task order: the lock button used
  // to sit only at the top, in the checks section, while
  // the fields it locks sat below it, so a pastor edited
  // down the page and had to scroll back up to lock. The
  // same approve/locked block now renders at the bottom
  // of the page too, so the next action is always the
  // next thing down, never a jump back up.
  const approveArea = locked ? (
    <div>
      <p><strong>Locked.</strong> Approved by {locked.pastorName}, {locked.church}.</p>
      <p>Approval code: <code>{locked.lockHash}</code></p>
      {saved && <p>{saved}</p>}
      {pdfLink && <p><a href={pdfLink}>Download print PDF (Letter)</a></p>}
      <p><a href={`/pack/${packSlug(locked, locked.id)}`}>View the public share page for this pack</a> | <a href="/packs">View my packs library</a></p>
      <button onClick={onUnlock}>Unlock to edit (creates a new draft)</button>
    </div>
  ) : (
    <div>
      <button onClick={onLock} style={{ padding: "10px 18px", fontSize: 16 }}>
        Approve and Lock
      </button>
      {lockError && <p><strong>{lockError}</strong></p>}
      {!canLock && !lockError && <p>One of the checks above needs fixing before this pack can lock. Tap the button and it will tell you which one.</p>}
    </div>
  );

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <JourneyStrip stage={locked ? "share" : "review"} />
      <h1>Flockpath: pastor review</h1>
      <p>Pastor double-checks. The system already checked every Scripture quote and looked for repeats. When both checks pass, Approve and Lock locks the pack.</p>
      {draftId && <p><strong>This is a draft for your review, not a finished pack.</strong> Nothing is final until you tap Approve and Lock.</p>}

      <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 24, background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>Checks before you lock</h2>
        <p>These update as you edit. Anything that must be fixed is also marked on that section itself, below.</p>
        <p><strong>Scripture quotes:</strong> {scripture.ok ? "Check out, word for word." : "Need fixing:"}</p>
        {!scripture.ok && <ul>{plainScripture.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <p><strong>Days are distinct:</strong> {quality.ok ? "Yes, each day covers its own ground." : "Need fixing:"}</p>
        {!quality.ok && <ul>{plainIssues.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {activeWarnings.length ? <div><p><strong>Worth a second look:</strong></p><ul>{activeWarnings.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => acceptWarning(w)}>This is fine</button></li>)}</ul><p>These do not block locking, but do not lock a flagged pack without reading each one. Edit the flagged field, uncheck that section, or tap &ldquo;This is fine&rdquo; if you have read it and it is right.</p></div> : null}
        {acceptedShown.length ? <div><p><strong>Checked by you:</strong></p><ul>{acceptedShown.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => unacceptWarning(w)}>Undo</button></li>)}</ul></div> : null}
        {hiddenWarningCount > 0 && <p>Plus {hiddenWarningCount} length note{hiddenWarningCount === 1 ? "" : "s"} kept in the background notes, not shown here. Length alone never stops a pack from locking.</p>}
        <p><strong>Your pack will include:</strong> {filteredPack.adultDevotionals.length} day{filteredPack.adultDevotionals.length === 1 ? "" : "s"} out of {pack.adultDevotionals.length}. The days you leave checked are the days in your pack.</p>
        {approveArea}
        <p><button onClick={onReset}>Start over from the generated draft</button></p>
      </section>

      <section style={{ border: "1px solid #ddd", padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Sections in the final pack</h2>
        <p>Uncheck a section and it will not go in the final pack. A day is adult plus kid together. The memory verse is always included. At least one day must stay.</p>
        {pack.adultDevotionals.map((a) => (
          <p key={a.day}><label><input type="checkbox" checked={isDayOn(a.day)} disabled={ro} onChange={() => toggleDay(a.day)} /> {a.day}: {a.title} ({formatRef(a.scripture.reference)})</label></p>
        ))}
        <p><label><input type="checkbox" checked={toggles.leader} disabled={ro} onChange={() => setToggles((t) => ({ ...t, leader: !t.leader }))} /> Small-group leader questions</label></p>
        <p><label><input type="checkbox" checked={toggles.song} disabled={ro} onChange={() => setToggles((t) => ({ ...t, song: !t.song }))} /> Song (hymn)</label></p>
        {pack.classicDevotional && <p><label><input type="checkbox" checked={toggles.classic} disabled={ro} onChange={() => setToggles((t) => ({ ...t, classic: !t.classic }))} /> Classic devotional: {pack.classicDevotional.title}{pack.classicDevotional.tradition_label ? ` (${pack.classicDevotional.tradition_label})` : ""}</label></p>}
        <p><label><input type="checkbox" checked={toggles.coloring} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coloring: !t.coloring }))} /> Coloring page</label></p>
        <p><label><input type="checkbox" checked={toggles.coverNote} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coverNote: !t.coverNote }))} /> Cover note</label></p>
        <p><label><input type="checkbox" checked disabled /> Memory verse: {fullRef(pack.memoryVerse.reference)} (always included)</label></p>
      </section>

      {(filteredPack.phosVoices?.commentary?.length || filteredPack.phosVoices?.devotionals?.length || filteredPack.classicDevotional?.tradition_label) ? (
        <section style={{ border: "1px solid #ddd", padding: 16, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>Voices in this pack</h2>
          <p>These are the study voices that shaped this draft. Your tradition setting put your tradition&apos;s voices first for this draft. To change voices for a future pack, change your tradition on My packs. Every voice is labeled so you can judge it: a label is a fact about the author, not an endorsement of every view.</p>
          {filteredPack.classicDevotional ? (
            <p><strong>Classic devotional:</strong> {filteredPack.classicDevotional.workTitle || filteredPack.classicDevotional.title}{filteredPack.classicDevotional.tradition_label ? ` (${filteredPack.classicDevotional.tradition_label})` : ""}</p>
          ) : null}
          {filteredPack.phosVoices?.commentary?.length ? (
            <div>
              <p><strong>Commentary voices:</strong></p>
              <ul>
                {filteredPack.phosVoices.commentary.map((v) => (
                  <li key={v.source}>{v.title}{v.tradition_label ? ` (${v.tradition_label})` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {filteredPack.phosVoices?.devotionals?.length ? (
            <div>
              <p><strong>Devotional voices in the rotation:</strong></p>
              <ul>
                {filteredPack.phosVoices.devotionals.map((v) => (
                  <li key={v.source}>{v.title}{v.tradition_label ? ` (${v.tradition_label})` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <Field label="Pack title" value={pack.title} readOnly={ro} onChange={(v) => set((p) => { p.title = v; })} />
        <Field label="Passage" value={pack.passage} readOnly={ro} onChange={(v) => set((p) => { p.passage = v; })} />
        <Field label="Pastor name" value={pack.pastorName} readOnly={ro} onChange={(v) => set((p) => { p.pastorName = v; })} />
        <Field label="Church" value={pack.church} readOnly={ro} onChange={(v) => set((p) => { p.church = v; })} />

        <h2>Memory verse (read-only text, from the verse store)</h2>
        <p>{fullRef(pack.memoryVerse.reference)}: {pack.memoryVerse.text}</p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Memory verse reference (text refills from the store)</span>
          <select disabled={ro} value={pack.memoryVerse.reference} onChange={(e) => set((p) => { p.memoryVerse = fillVerse(e.target.value, store); })}>
            {allowedRefs.map((r) => <option key={r} value={r}>{fullRef(r)}</option>)}
          </select>
        </label>

        <section style={{ border: "1px solid #ddd", padding: 16, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>On the cover</h2>
          <p>One short block on the cover page, under the memory verse. {pack.sermonSnapshot?.summary?.trim() ? "Your sermon gave this draft a short summary and one quote, shown below. Edit them here. The cover prints the sermon summary." : "This draft has no sermon summary, so the cover stays plain unless you write your own note below."}</p>
          {pack.sermonSnapshot ? (
            <div>
              <Field label="Sermon summary (at most 45 words)" multiline maxLength={320} value={pack.sermonSnapshot.summary} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.summary = v; })} />
              <p>{wordCount(pack.sermonSnapshot.summary)} words.</p>
              <Field label="Quote from the sermon (at most 30 words, exact words)" multiline maxLength={220} value={pack.sermonSnapshot.quote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.quote = stripQuoteMarks(v); })} />
              <p>Quotation marks are added automatically when the pack prints, no need to type them.</p>
              <p>{wordCount(pack.sermonSnapshot.quote ?? "")} words. {pack.sermonSnapshot.quote ? (quoteMatchesSermon ? "Matches the sermon you pasted." : "This quote does not match the sermon text. Fix it, or clear it, or the pack cannot lock.") : "No quote. Only the summary will print."}</p>
            </div>
          ) : null}
          {/* Nov 5, 2026, v26, Jeremiah's call: one or the
              other, not both. The note section hides when
              a sermon summary is already there, and
              appears when there is none (a topic-built
              pack). A note already filled in still shows,
              so a note written before this change is never
              hidden while it prints. */}
          {(!(pack.sermonSnapshot?.summary ?? "").trim() || (pack.pastorNote?.verse?.text && (pack.pastorNote?.note ?? "").trim())) ? (
            <>
              <h3>Your own note</h3>
              <p>Add a verse and a few words in your own voice. This prints on the cover instead of the sermon summary above.</p>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Verse (for example James 1:4)</span>
                <input style={{ width: "100%", padding: 8, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, background: ro ? "#eee" : "#fff" }} value={noteRef} readOnly={ro} onChange={(e) => setNoteRef(e.target.value)} onBlur={() => { if (noteRef.trim() && !ro) resolveNoteVerse(noteRef); }} />
              </label>
              {noteVerseStatus === "checking" ? <p>Checking the verse…</p> : null}
              {noteVerseStatus === "found" && pack.pastorNote?.verse?.text ? <p>{fullRef(pack.pastorNote.verse.reference)}: &ldquo;{pack.pastorNote.verse.text}&rdquo;</p> : null}
              {noteVerseStatus === "not-found" ? <p>That verse was not found. Check the chapter and verse.</p> : null}
              {noteVerseStatus === "unknown-book" ? <p>I can&apos;t find that book. Use the full name, like James 1:4.</p> : null}
              <Field label="Your words (at most 40 words)" multiline maxLength={300} value={pack.pastorNote?.note ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.pastorNote = { ...(p.pastorNote ?? { verse: { reference: "", translation: "bsb", text: "" } }), note: v }; })} />
              <p>{wordCount(pack.pastorNote?.note ?? "")} words.</p>
            </>
          ) : null}
          <p><strong>{!toggles.coverNote ? "The cover note is unchecked, so nothing prints on the cover." : (pack.pastorNote?.verse?.text && (pack.pastorNote?.note ?? "").trim() ? "Your own note will print on the cover." : ((pack.sermonSnapshot?.summary ?? "").trim() ? "The sermon summary will print on the cover." : "Nothing will print on the cover yet. Fill in your note above, or leave it blank."))}</strong></p>
        </section>

        {pack.adultDevotionals.map((a, i) => {
          const k = pack.kidDevotionals[i];
          const day = a.day;
          if (!a || !k) return null;
          const on = isDayOn(day);
          // Nov 4, 2026, section flags (Mac test item 23):
          // a flagged day says so on its own card, so the
          // pastor never has to connect a distant check list
          // to the field that needs fixing.
          const dayFlags = on ? flagsForDay(day) : { issues: [], warnings: [] };
          return (
            <section key={day} className="fp-day-card" style={{ opacity: on ? 1 : 0.55 }}>
              <h2>{day}{on ? "" : " - excluded from final pack"}</h2>
              {(dayFlags.issues.length > 0 || dayFlags.warnings.length > 0) && (
                <div style={{ color: "darkred" }}>
                  <p><strong>Needs a look:</strong></p>
                  {dayFlags.issues.map((t, i) => (
                    <p key={`i${i}`}>{t} {/quotes its verse verbatim/.test(t) && (
                      <button type="button" disabled={ro || rewriteState[day]?.status === "running"} onClick={() => rewriteDayBody(day)}>
                        {rewriteState[day]?.status === "running" ? "Rewriting..." : "Rewrite this section"}
                      </button>
                    )}</p>
                  ))}
                  {rewriteState[day]?.message && <p>{rewriteState[day].message}</p>}
                  {dayFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>This is fine</button></p>)}
                </div>
              )}
              <Field label="Adult title" value={a.title} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].title = v; })} />
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Adult Scripture reference (text refills from the store)</span>
                <select disabled={ro} value={a.scripture.reference} onChange={(e) => set((p) => { p.adultDevotionals[i].scripture = fillVerse(e.target.value, store); })}>
                  {allowedRefs.map((r) => <option key={r} value={r}>{fullRef(r)}</option>)}
                </select>
              </label>
              <p>Scripture text: &ldquo;{a.scripture.text}&rdquo;</p>
              <Field label="For adults" multiline value={a.body} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].body = v; })} />
              <Field label="Adult prayer" multiline value={a.prayer} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].prayer = v; })} />
              <Field label="Kid title (ages 6-10)" value={k.title} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].title = v; })} />
              <Field label="Kid retelling (plain words, not a quote)" multiline value={k.retelling} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].retelling = v; })} />
              <Field label="Kid activity" multiline value={k.activity} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].activity = v; })} />
            </section>
          );
        })}

        <h2>Small-group questions</h2>
        {(leaderFlags.issues.length > 0 || leaderFlags.warnings.length > 0) && (
          <div style={{ color: "darkred" }}>
            <p><strong>Needs a look:</strong></p>
            {leaderFlags.issues.map((t, i) => <p key={`i${i}`}>{t}</p>)}
            {leaderFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>This is fine</button></p>)}
          </div>
        )}
        {pack.leaderQuestions.map((q, i) => {
          // Nov 5, 2026, round-5: a question belongs to the
          // day at the same index, so an unchecked day's
          // question shows dimmed and labeled, like an
          // unchecked day card, instead of looking live.
          const qDay = dayNames[i];
          const qOn = toggles.leader && (!qDay || isDayOn(qDay));
          return (
          <div key={i} style={{ opacity: qOn ? 1 : 0.55 }}>
            {!qOn && <p><strong>Question {i + 1}{qDay ? ` (${qDay})` : ""} - excluded from final pack</strong></p>}
            {/* Nov 4, 2026, readability (Mac test item 20):
            questions and notes used to be single-line fields
            that cut long text off mid-word. They are now
            multi-line, so the whole question and note read
            on the page. */}
            <Field label={`Question ${i + 1}`} multiline value={q.question} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].question = v; })} />
            <Field label="Leader note" multiline value={q.leaderNote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].leaderNote = v; })} />
          </div>
          );
        })}

        {pack.chorus ? (
          <>
            <h2>Original chorus (legacy pack only)</h2>
            <p>New packs do not generate original choruses. This section only shows for a pack locked before that change.</p>
            <Field label="Chorus title" value={pack.chorus.title} readOnly={ro} onChange={(v) => set((p) => { p.chorus.title = v; })} />
            <Field label="ChordPro" multiline value={pack.chorus.chordPro} readOnly={ro} onChange={(v) => set((p) => { p.chorus.chordPro = v; })} />
            <p>Original: {pack.chorus.original ? "yes" : "no - locking will fail"}</p>
          </>
        ) : null}

        {pack.hymnCandidates?.length ? (
          <section style={{ border: "1px solid #ddd", padding: 16 }}>
            <h2>Song for the week: pick a hymn</h2>
            <p>{pack.hymnCandidates.some((h) => h.related) ? "No hymn matched this passage exactly. These public-domain hymns are the closest ones in the index. Pick one if it fits your sermon, or choose no song." : "The system matched these public-domain hymns to this passage. Picking one is a choice, not a fix: the auto-pick is already a verified hymn. If you pick none of them, no song will print."}</p>
            {pack.hymnCandidates.map((h) => (
              <p key={h.id}>
                <button type="button" disabled={ro} onClick={() => set((p) => { p.hymn = { ...h }; delete p.hymn.related; })}>
                  {pack.hymn?.id === h.id ? "Chosen: " : "Use: "}{h.title} ({h.tune})
                </button>
                {" "}Words: {h.author} ({h.authorYears}), {h.wordsYear}. Meter: {h.meter}. Public domain in the US.
              </p>
            ))}
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>No song for this week</button></p>
            {pack.hymn ? <p><strong>Now chosen:</strong> {pack.hymn.title} ({pack.hymn.tune}). This is the song that will print on page 8.</p> : <p><strong>Now chosen:</strong> no song. No song page will print.</p>}
          </section>
        ) : null}
        {pack.hymn && !pack.hymnCandidates?.length ? (
          <section style={{ border: "1px solid #ddd", padding: 16 }}>
            <h2>Hymn</h2>
            <p>{pack.hymn.title} ({pack.hymn.tune}). Words: {pack.hymn.author} ({pack.hymn.authorYears}), {pack.hymn.wordsYear}. Public domain in the US.</p>
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>No song for this week</button></p>
          </section>
        ) : null}

        {!pack.hymn && !pack.chorus && !pack.hymnCandidates?.length ? <p>No hymn in the index fits this passage, so no song page will print for this pack.</p> : null}

        <h2>Coloring</h2>
        <Field label="Coloring title" value={pack.coloring.title} readOnly={ro} onChange={(v) => set((p) => { p.coloring.title = v; })} />
        <Field label="Coloring description" multiline value={pack.coloring.description} readOnly={ro} onChange={(v) => set((p) => { p.coloring.description = v; })} />
        {(() => {
          // Nov 1, 2026, coloring preview fix: the old code
          // always previewed creation-sky-earth-v1, even for a
          // Psalm or Romans pack. The preview now shows the
          // matched template for this pack, or the pastor's
          // picked template if they chose one below. The PDF
          // builder respects the same pick, so preview and
          // print can no longer disagree.
          const matched = matchColoring(pack);
          const chosen = COLORING_TEMPLATES[pack.coloring.svgTemplateId] ? pack.coloring.svgTemplateId : matched;
          const tpl = COLORING_TEMPLATES[chosen];
          return (
            <div>
              <p>Template: {chosen} - {tpl.caption}</p>
              <img src={`/coloring/${tpl.file}`} alt={tpl.alt} width={400} style={{ border: "1px solid #ccc", background: "#fff" }} />
              <p>Pick a different coloring page, or keep the matched one. The swap offers the 10-theme PNG library (COLORING-10.md).</p>
              {Object.entries(COLORING_TEMPLATES).map(([id, t]) => (
                <p key={id}>
                  <button type="button" disabled={ro} onClick={() => set((p) => { p.coloring.svgTemplateId = id; p.coloring.description = t.caption; })}>
                    {id === chosen ? "Chosen: " : "Use: "}{t.caption}
                  </button>
                </p>
              ))}
            </div>
          );
        })()}
      </section>

      <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginTop: 24, background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>Ready to lock?</h2>
        {approveArea}
      </section>
    </main>
  );
}
